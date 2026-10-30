import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { BookingSource, BookingStatus, Prisma, Role, RoomStatus } from '@prisma/client';
import { randomInt } from 'node:crypto';
import { AuditService } from '../common/audit.service';
import { AuthUser } from '../common/decorators';
import { addDays, DateOnly, diffDays, fromDbDate, priceBooking, summariseBalance, todaySast, toDbDate } from '../common/domain';
import { GuestInputDto, GuestsService } from '../guests/guests.module';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';
import { bookingInclude, toBookingDto } from './booking.mapper';

export interface CreateBookingInput {
  guestId?: string;
  guest?: GuestInputDto;
  roomId: string;
  checkIn: DateOnly;
  checkOut: DateOnly;
  adults: number;
  children: number;
  source: BookingSource;
  status?: BookingStatus;
  nightlyRateCents?: number;
  depositRequiredCents?: number;
  specialRequests?: string;
  internalNotes?: string;
}

export interface UpdateBookingInput {
  roomId?: string;
  checkIn?: DateOnly;
  checkOut?: DateOnly;
  adults?: number;
  children?: number;
  source?: BookingSource;
  status?: BookingStatus;
  nightlyRateCents?: number;
  depositRequiredCents?: number;
  specialRequests?: string | null;
  internalNotes?: string | null;
}

export interface BookingListQuery {
  status?: string;
  from?: DateOnly;
  to?: DateOnly;
  q?: string;
  paymentStatus?: string;
  roomId?: string;
}

/** Statuses a booking may move to via a plain edit. Check-in/out and cancel have their own actions. */
const EDIT_TRANSITIONS: Partial<Record<BookingStatus, BookingStatus[]>> = {
  PENDING: [BookingStatus.CONFIRMED],
  CONFIRMED: [BookingStatus.PENDING],
};

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newReference() {
  let s = '';
  for (let i = 0; i < 6; i++) s += REF_ALPHABET[randomInt(REF_ALPHABET.length)];
  return `BK-${s}`;
}

/** The database exclusion constraint (see migration) is the final guard against double bookings. */
function isOverlapViolation(err: unknown) {
  return err instanceof Error && err.message.includes('booking_no_overlap');
}

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly guests: GuestsService,
    private readonly settings: SettingsService,
  ) {}

  async get(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id }, include: bookingInclude });
    if (!booking) throw new NotFoundException('Booking not found');
    return toBookingDto(booking);
  }

  async list(query: BookingListQuery) {
    const where: Prisma.BookingWhereInput = {};
    if (query.status) where.status = { in: query.status.split(',') as BookingStatus[] };
    if (query.roomId) where.roomId = query.roomId;
    // Bookings whose stay overlaps [from, to]
    if (query.from) where.checkOut = { gt: toDbDate(query.from) };
    if (query.to) where.checkIn = { lte: toDbDate(query.to) };
    const q = query.q?.trim();
    if (q) {
      const phoneDigits = q.replace(/\D/g, '').replace(/^0/, '');
      where.OR = [
        { reference: { contains: q, mode: 'insensitive' } },
        { guest: { firstName: { contains: q, mode: 'insensitive' } } },
        { guest: { lastName: { contains: q, mode: 'insensitive' } } },
        ...(phoneDigits.length >= 3 ? [{ guest: { phone: { contains: phoneDigits } } }] : []),
        { room: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const rows = await this.prisma.booking.findMany({
      where,
      include: bookingInclude,
      orderBy: { checkIn: query.from || query.to ? 'asc' : 'desc' },
      take: 500,
    });
    let result = rows.map(toBookingDto);
    if (query.paymentStatus) {
      const wanted = query.paymentStatus.split(',');
      result = result.filter((b) => wanted.includes(b.balance.paymentStatus));
    }
    return result;
  }

  /** Rooms free for [checkIn, checkOut), optionally ignoring one booking (when editing it). */
  async availability(checkIn: DateOnly, checkOut: DateOnly, excludeBookingId?: string) {
    if (diffDays(checkIn, checkOut) < 1) throw new BadRequestException('Check-out must be after check-in');
    const [rooms, clashes] = await Promise.all([
      this.prisma.room.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.booking.findMany({
        where: {
          status: { not: BookingStatus.CANCELLED },
          checkIn: { lt: toDbDate(checkOut) },
          checkOut: { gt: toDbDate(checkIn) },
          ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        },
        select: { roomId: true, reference: true, checkIn: true, checkOut: true },
      }),
    ]);
    return rooms.map((room) => {
      const conflicts = clashes.filter((c) => c.roomId === room.id);
      return {
        id: room.id,
        name: room.name,
        pricePerNightCents: room.pricePerNightCents,
        maxGuests: room.maxGuests,
        status: room.status,
        available: conflicts.length === 0 && room.status !== RoomStatus.MAINTENANCE,
        reason:
          conflicts.length > 0
            ? `Booked (${conflicts.map((c) => c.reference).join(', ')})`
            : room.status === RoomStatus.MAINTENANCE
              ? 'Under maintenance'
              : null,
      };
    });
  }

  async create(input: CreateBookingInput, user: AuthUser) {
    if (!input.guestId && !input.guest) throw new BadRequestException('Select an existing guest or enter new guest details');
    const today = todaySast();
    if (input.checkIn < addDays(today, -1)) throw new BadRequestException('Check-in date cannot be in the past');
    if (input.status && !([BookingStatus.PENDING, BookingStatus.CONFIRMED] as BookingStatus[]).includes(input.status)) {
      throw new BadRequestException('New bookings must be Pending or Confirmed');
    }
    if (input.nightlyRateCents !== undefined && user.role !== Role.OWNER) {
      throw new BadRequestException('Only the owner can change the nightly rate');
    }

    const [room, settings] = await Promise.all([
      this.prisma.room.findUnique({ where: { id: input.roomId } }),
      this.settings.get(),
    ]);
    if (!room || !room.active) throw new BadRequestException('Room not found');
    this.assertCapacity(room.maxGuests, input.adults, input.children);

    const nightlyRateCents = input.nightlyRateCents ?? room.pricePerNightCents;
    const pricing = this.price(input.checkIn, input.checkOut, nightlyRateCents, settings);

    try {
      const id = await this.prisma.$transaction(
        async (tx) => {
          await this.assertRoomFree(tx, room.id, input.checkIn, input.checkOut);
          const guestId = input.guestId ?? (await this.guests.create(input.guest!, user.id, tx)).id;
          const booking = await tx.booking.create({
            data: {
              reference: newReference(),
              guestId,
              roomId: room.id,
              checkIn: toDbDate(input.checkIn),
              checkOut: toDbDate(input.checkOut),
              adults: input.adults,
              children: input.children,
              source: input.source,
              status: input.status ?? BookingStatus.PENDING,
              nightlyRateCents,
              nights: pricing.nights,
              totalCents: pricing.totalCents,
              vatCents: pricing.vatCents,
              depositRequiredCents: input.depositRequiredCents ?? pricing.depositRequiredCents,
              specialRequests: input.specialRequests?.trim() || null,
              internalNotes: input.internalNotes?.trim() || null,
              createdById: user.id,
            },
          });
          await this.audit.log(user.id, 'CREATE', 'Booking', booking.id, {
            reference: booking.reference,
            room: room.name,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            totalCents: booking.totalCents,
          }, tx);
          return booking.id;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.get(id);
    } catch (err) {
      throw this.mapWriteError(err);
    }
  }

  async update(id: string, input: UpdateBookingInput, user: AuthUser) {
    const existing = await this.prisma.booking.findUnique({ where: { id }, include: { room: true } });
    if (!existing) throw new NotFoundException('Booking not found');
    const status = existing.status;
    if (status === BookingStatus.CANCELLED || status === BookingStatus.CHECKED_OUT) {
      throw new BadRequestException(`A ${status === 'CANCELLED' ? 'cancelled' : 'checked-out'} booking can no longer be edited`);
    }
    if (status === BookingStatus.CHECKED_IN && (input.checkIn !== undefined && input.checkIn !== fromDbDate(existing.checkIn))) {
      throw new BadRequestException('The guest has already checked in, so the arrival date cannot change');
    }
    if (input.status && input.status !== status && !EDIT_TRANSITIONS[status]?.includes(input.status)) {
      throw new BadRequestException('Use the Check in, Check out or Cancel actions to change this status');
    }
    if (input.nightlyRateCents !== undefined && input.nightlyRateCents !== existing.nightlyRateCents && user.role !== Role.OWNER) {
      throw new BadRequestException('Only the owner can change the nightly rate');
    }

    const checkIn = input.checkIn ?? fromDbDate(existing.checkIn);
    const checkOut = input.checkOut ?? fromDbDate(existing.checkOut);
    const roomId = input.roomId ?? existing.roomId;
    const roomChanged = roomId !== existing.roomId;
    if (roomChanged && status === BookingStatus.CHECKED_IN) {
      throw new BadRequestException('To move a checked-in guest, check them out and create a new booking');
    }
    const datesChanged = checkIn !== fromDbDate(existing.checkIn) || checkOut !== fromDbDate(existing.checkOut);

    const room = roomChanged ? await this.prisma.room.findUnique({ where: { id: roomId } }) : existing.room;
    if (!room || !room.active) throw new BadRequestException('Room not found');
    this.assertCapacity(room.maxGuests, input.adults ?? existing.adults, input.children ?? existing.children);

    // Moving rooms takes the new room's rate unless the owner sets one explicitly.
    const nightlyRateCents = input.nightlyRateCents ?? (roomChanged ? room.pricePerNightCents : existing.nightlyRateCents);
    const repriced = datesChanged || roomChanged || nightlyRateCents !== existing.nightlyRateCents;
    const settings = await this.settings.get();
    const pricing = repriced ? this.price(checkIn, checkOut, nightlyRateCents, settings) : null;

    const data: Prisma.BookingUncheckedUpdateInput = {
      roomId,
      adults: input.adults,
      children: input.children,
      source: input.source,
      status: input.status,
      specialRequests: input.specialRequests === undefined ? undefined : input.specialRequests?.trim() || null,
      internalNotes: input.internalNotes === undefined ? undefined : input.internalNotes?.trim() || null,
      updatedById: user.id,
      ...(pricing && {
        checkIn: toDbDate(checkIn),
        checkOut: toDbDate(checkOut),
        nightlyRateCents,
        nights: pricing.nights,
        totalCents: pricing.totalCents,
        vatCents: pricing.vatCents,
        depositRequiredCents: pricing.depositRequiredCents,
      }),
      ...(input.depositRequiredCents !== undefined && { depositRequiredCents: input.depositRequiredCents }),
    };

    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (datesChanged || roomChanged) await this.assertRoomFree(tx, roomId, checkIn, checkOut, id);
          await tx.booking.update({ where: { id }, data });
          await this.audit.log(user.id, 'UPDATE', 'Booking', id, {
            reference: existing.reference,
            changes: JSON.parse(JSON.stringify(input)),
            ...(pricing && { previousTotalCents: existing.totalCents, totalCents: pricing.totalCents }),
          }, tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      throw this.mapWriteError(err);
    }
    return this.get(id);
  }

  async cancel(id: string, reason: string | undefined, cancellationFeeCents: number, user: AuthUser) {
    const existing = await this.prisma.booking.findUniqueOrThrow({ where: { id } });
    if (!([BookingStatus.PENDING, BookingStatus.CONFIRMED] as BookingStatus[]).includes(existing.status)) {
      throw new BadRequestException('Only pending or confirmed bookings can be cancelled');
    }
    if (cancellationFeeCents > existing.totalCents) {
      throw new BadRequestException('The cancellation fee cannot be more than the booking total');
    }
    await this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: reason?.trim() || null,
        cancellationFeeCents,
        updatedById: user.id,
      },
    });
    await this.audit.log(user.id, 'CANCEL', 'Booking', id, { reference: existing.reference, reason, cancellationFeeCents });
    return this.get(id);
  }

  async checkIn(id: string, user: AuthUser) {
    const b = await this.prisma.booking.findUniqueOrThrow({ where: { id }, include: { room: true } });
    if (!([BookingStatus.PENDING, BookingStatus.CONFIRMED] as BookingStatus[]).includes(b.status)) {
      throw new BadRequestException('Only pending or confirmed bookings can be checked in');
    }
    const today = todaySast();
    if (fromDbDate(b.checkIn) > today) {
      throw new BadRequestException(`This booking only starts on ${fromDbDate(b.checkIn)}. Change the arrival date first.`);
    }
    if (fromDbDate(b.checkOut) <= today) {
      throw new BadRequestException('This booking has already ended. Extend the departure date first.');
    }
    if (b.room.status === RoomStatus.MAINTENANCE) {
      throw new BadRequestException(`${b.room.name} is marked for maintenance`);
    }
    const occupant = await this.prisma.booking.findFirst({
      where: { roomId: b.roomId, status: BookingStatus.CHECKED_IN, id: { not: id } },
      select: { reference: true },
    });
    if (occupant) throw new ConflictException(`${b.room.name} still has a guest checked in (${occupant.reference})`);

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id },
        data: { status: BookingStatus.CHECKED_IN, actualCheckInAt: new Date(), updatedById: user.id },
      }),
      this.prisma.room.update({ where: { id: b.roomId }, data: { status: RoomStatus.OCCUPIED } }),
    ]);
    await this.audit.log(user.id, 'CHECK_IN', 'Booking', id, { reference: b.reference });
    return this.get(id);
  }

  /**
   * Checks the guest out and marks the room for cleaning. Refuses while money is outstanding
   * unless `acknowledgeBalance` is set, so the receptionist always sees the balance first.
   */
  async checkOut(id: string, acknowledgeBalance: boolean, user: AuthUser) {
    const b = await this.prisma.booking.findUniqueOrThrow({ where: { id }, include: { payments: true } });
    if (b.status !== BookingStatus.CHECKED_IN) throw new BadRequestException('Only checked-in guests can be checked out');
    const balance = summariseBalance(b, b.payments);
    if (balance.outstandingCents > 0 && !acknowledgeBalance) {
      throw new ConflictException({
        message: 'This guest still has an outstanding balance',
        code: 'OUTSTANDING_BALANCE',
        outstandingCents: balance.outstandingCents,
      });
    }

    // Early departure frees the remaining nights for new bookings. The amount owed is unchanged;
    // the owner can adjust it by editing the booking if a partial refund is agreed.
    const today = todaySast();
    const plannedCheckOut = fromDbDate(b.checkOut);
    const earliestCheckOut = addDays(fromDbDate(b.checkIn), 1);
    let newCheckOut = plannedCheckOut;
    if (today < plannedCheckOut) newCheckOut = today < earliestCheckOut ? earliestCheckOut : today;

    await this.prisma.$transaction([
      this.prisma.booking.update({
        where: { id },
        data: {
          status: BookingStatus.CHECKED_OUT,
          actualCheckOutAt: new Date(),
          checkOut: toDbDate(newCheckOut),
          updatedById: user.id,
        },
      }),
      this.prisma.room.update({ where: { id: b.roomId }, data: { status: RoomStatus.CLEANING } }),
    ]);
    await this.audit.log(user.id, 'CHECK_OUT', 'Booking', id, {
      reference: b.reference,
      outstandingCents: balance.outstandingCents,
      ...(newCheckOut !== plannedCheckOut && { earlyDeparture: { planned: plannedCheckOut, actual: newCheckOut } }),
    });
    return this.get(id);
  }

  /** Rooms and bookings for the calendar between [from, to). */
  async calendar(from: DateOnly, to: DateOnly) {
    if (diffDays(from, to) < 1 || diffDays(from, to) > 62) throw new BadRequestException('Calendar range must be 1–62 days');
    const [rooms, bookings] = await Promise.all([
      this.prisma.room.findMany({
        where: { active: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, status: true, pricePerNightCents: true, maxGuests: true },
      }),
      this.prisma.booking.findMany({
        where: {
          status: { not: BookingStatus.CANCELLED },
          checkIn: { lt: toDbDate(to) },
          checkOut: { gt: toDbDate(from) },
        },
        include: { guest: { select: { firstName: true, lastName: true, phone: true } }, payments: true },
      }),
    ]);
    return {
      from,
      to,
      today: todaySast(),
      rooms,
      bookings: bookings.map(({ payments, ...b }) => ({
        id: b.id,
        reference: b.reference,
        roomId: b.roomId,
        checkIn: fromDbDate(b.checkIn),
        checkOut: fromDbDate(b.checkOut),
        status: b.status,
        adults: b.adults,
        children: b.children,
        guestName: `${b.guest.firstName} ${b.guest.lastName}`,
        guestPhone: b.guest.phone,
        totalCents: b.totalCents,
        balance: summariseBalance(b, payments),
      })),
    };
  }

  private price(checkIn: DateOnly, checkOut: DateOnly, nightlyRateCents: number, settings: { vatRegistered: boolean; vatRateBps: number; defaultDepositPercent: number }) {
    if (diffDays(checkIn, checkOut) < 1) throw new BadRequestException('Check-out must be at least one night after check-in');
    if (diffDays(checkIn, checkOut) > 90) throw new BadRequestException('Bookings are limited to 90 nights');
    return priceBooking({
      checkIn,
      checkOut,
      nightlyRateCents,
      vatRegistered: settings.vatRegistered,
      vatRateBps: settings.vatRateBps,
      depositPercent: settings.defaultDepositPercent,
    });
  }

  private assertCapacity(maxGuests: number, adults: number, children: number) {
    if (adults < 1) throw new BadRequestException('At least one adult is required');
    if (adults + children > maxGuests) {
      throw new BadRequestException(`This room sleeps a maximum of ${maxGuests} guests`);
    }
  }

  private async assertRoomFree(tx: Prisma.TransactionClient, roomId: string, checkIn: DateOnly, checkOut: DateOnly, excludeId?: string) {
    const clash = await tx.booking.findFirst({
      where: {
        roomId,
        status: { not: BookingStatus.CANCELLED },
        checkIn: { lt: toDbDate(checkOut) },
        checkOut: { gt: toDbDate(checkIn) },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      include: { guest: { select: { firstName: true, lastName: true } } },
    });
    if (clash) {
      throw new ConflictException(
        `Room is already booked from ${fromDbDate(clash.checkIn)} to ${fromDbDate(clash.checkOut)} ` +
          `(${clash.reference}, ${clash.guest.firstName} ${clash.guest.lastName})`,
      );
    }
  }

  private mapWriteError(err: unknown) {
    if (isOverlapViolation(err)) return new ConflictException('That room was just booked for these dates. Please choose another room or dates.');
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') {
      return new ConflictException('Another booking was saved at the same time. Please try again.');
    }
    return err;
  }
}
