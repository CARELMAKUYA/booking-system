import { BadRequestException, Injectable } from '@nestjs/common';
import { BookingStatus, PaymentMethod, PaymentType } from '@prisma/client';
import { addDays, DateOnly, diffDays, fromDbDate, summariseBalance, todaySast, toDbDate, vatFromInclusive } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.module';

const signed = (p: { type: PaymentType; amountCents: number }) => (p.type === PaymentType.REFUND ? -p.amountCents : p.amountCents);

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Report for the inclusive date range [from, to]. */
  async summary(from: DateOnly, to: DateOnly) {
    const days = diffDays(from, to) + 1;
    if (days < 1 || days > 366) throw new BadRequestException('Report range must be between 1 and 366 days');
    const toExclusive = addDays(to, 1);

    const [settings, rooms, payments, stays, created, cancelled] = await Promise.all([
      this.settings.get(),
      this.prisma.room.findMany({ where: { active: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.payment.findMany({
        where: { voidedAt: null, paymentDate: { gte: toDbDate(from), lte: toDbDate(to) } },
        include: {
          booking: { select: { reference: true, guest: { select: { firstName: true, lastName: true } }, room: { select: { name: true } } } },
          recordedBy: { select: { name: true } },
        },
        orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.booking.findMany({
        where: { status: { not: BookingStatus.CANCELLED }, checkIn: { lt: toDbDate(toExclusive) }, checkOut: { gt: toDbDate(from) } },
        select: { id: true, roomId: true, checkIn: true, checkOut: true, nights: true, totalCents: true },
      }),
      this.prisma.booking.count({ where: { createdAt: { gte: sastStart(from), lt: sastStart(toExclusive) } } }),
      this.prisma.booking.count({ where: { cancelledAt: { gte: sastStart(from), lt: sastStart(toExclusive) } } }),
    ]);

    const verified = payments.filter((p) => p.verified);
    const sumBy = (pred: (p: (typeof payments)[number]) => boolean) => verified.filter(pred).reduce((s, p) => s + signed(p), 0);
    const cashCents = sumBy((p) => p.method === PaymentMethod.CASH);
    const eftCents = sumBy((p) => p.method === PaymentMethod.EFT);
    const totalReceivedCents = cashCents + eftCents;

    // Room-nights and accommodation value earned within the range (pro-rated per night).
    const daily = new Map<DateOnly, { date: DateOnly; occupiedRooms: number; arrivals: number; departures: number; cashCents: number; eftCents: number; pendingEftCents: number }>();
    for (let i = 0; i < days; i++) {
      const date = addDays(from, i);
      daily.set(date, { date, occupiedRooms: 0, arrivals: 0, departures: 0, cashCents: 0, eftCents: 0, pendingEftCents: 0 });
    }
    const perRoom = new Map(rooms.map((r) => [r.id, { roomId: r.id, name: r.name, nights: 0, earnedCents: 0 }]));
    for (const b of stays) {
      const ci = fromDbDate(b.checkIn);
      const co = fromDbDate(b.checkOut);
      const nightly = b.nights > 0 ? b.totalCents / b.nights : 0;
      const arrivalDay = daily.get(ci);
      if (arrivalDay) arrivalDay.arrivals++;
      const departureDay = daily.get(co);
      if (departureDay) departureDay.departures++;
      for (let d = ci < from ? from : ci; d < co && d <= to; d = addDays(d, 1)) {
        daily.get(d)!.occupiedRooms++;
        const r = perRoom.get(b.roomId);
        if (r) {
          r.nights++;
          r.earnedCents += nightly;
        }
      }
    }
    for (const p of payments) {
      const row = daily.get(fromDbDate(p.paymentDate));
      if (!row) continue;
      if (!p.verified) row.pendingEftCents += p.amountCents;
      else if (p.method === PaymentMethod.CASH) row.cashCents += signed(p);
      else row.eftCents += signed(p);
    }

    const roomNightsAvailable = rooms.length * days;
    const roomNightsSold = [...perRoom.values()].reduce((s, r) => s + r.nights, 0);
    const outstanding = await this.outstanding();

    return {
      from,
      to,
      days,
      business: { name: settings.businessName, vatRegistered: settings.vatRegistered, vatNumber: settings.vatNumber },
      revenue: {
        totalReceivedCents,
        cashCents,
        eftCents,
        depositsCents: sumBy((p) => p.type === PaymentType.DEPOSIT),
        refundsCents: -sumBy((p) => p.type === PaymentType.REFUND),
        pendingEftCents: payments.filter((p) => !p.verified).reduce((s, p) => s + p.amountCents, 0),
        vatCents: settings.vatRegistered ? vatFromInclusive(totalReceivedCents, settings.vatRateBps) : 0,
      },
      bookings: { created, cancelled },
      occupancy: {
        roomNightsSold,
        roomNightsAvailable,
        occupancyPercent: roomNightsAvailable ? Math.round((roomNightsSold / roomNightsAvailable) * 1000) / 10 : 0,
        averageRateCents: roomNightsSold ? Math.round([...perRoom.values()].reduce((s, r) => s + r.earnedCents, 0) / roomNightsSold) : 0,
        rooms: [...perRoom.values()].map((r) => ({
          ...r,
          earnedCents: Math.round(r.earnedCents),
          occupancyPercent: days ? Math.round((r.nights / days) * 1000) / 10 : 0,
        })),
      },
      daily: [...daily.values()],
      payments: payments.map((p) => ({
        id: p.id,
        paymentDate: fromDbDate(p.paymentDate),
        bookingReference: p.booking.reference,
        guestName: `${p.booking.guest.firstName} ${p.booking.guest.lastName}`,
        roomName: p.booking.room.name,
        type: p.type,
        method: p.method,
        amountCents: p.amountCents,
        reference: p.reference,
        verified: p.verified,
        recordedBy: p.recordedBy.name,
      })),
      outstanding,
    };
  }

  /** Bookings where money is owed or a refund is due, as of now. */
  async outstanding() {
    const bookings = await this.prisma.booking.findMany({
      where: {
        OR: [
          { status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT] } },
          { status: BookingStatus.CANCELLED, payments: { some: { voidedAt: null } } },
        ],
      },
      include: { payments: true, guest: { select: { firstName: true, lastName: true, phone: true } }, room: { select: { name: true } } },
      orderBy: { checkIn: 'asc' },
    });
    return bookings
      .map((b) => ({ b, balance: summariseBalance(b, b.payments) }))
      .filter(({ balance }) => balance.outstandingCents !== 0 || balance.pendingVerificationCents > 0)
      .map(({ b, balance }) => ({
        id: b.id,
        reference: b.reference,
        status: b.status,
        checkIn: fromDbDate(b.checkIn),
        checkOut: fromDbDate(b.checkOut),
        guestName: `${b.guest.firstName} ${b.guest.lastName}`,
        guestPhone: b.guest.phone,
        roomName: b.room.name,
        totalCents: b.totalCents,
        depositRequiredCents: b.depositRequiredCents,
        ...balance,
      }));
  }

  /** Daily cash reconciliation: what should be in the cash drawer, and what came in by EFT. */
  async cashUp(date: DateOnly) {
    const payments = await this.prisma.payment.findMany({
      where: { paymentDate: toDbDate(date) },
      include: {
        booking: { select: { id: true, reference: true, guest: { select: { firstName: true, lastName: true } }, room: { select: { name: true } } } },
        recordedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const live = payments.filter((p) => !p.voidedAt);
    const cash = live.filter((p) => p.method === PaymentMethod.CASH);
    const eft = live.filter((p) => p.method === PaymentMethod.EFT);
    const byStaff = new Map<string, { name: string; cashCents: number; eftCents: number; count: number }>();
    for (const p of live) {
      const s = byStaff.get(p.recordedBy.id) ?? { name: p.recordedBy.name, cashCents: 0, eftCents: 0, count: 0 };
      if (p.method === PaymentMethod.CASH) s.cashCents += signed(p);
      else if (p.verified) s.eftCents += signed(p);
      s.count++;
      byStaff.set(p.recordedBy.id, s);
    }
    return {
      date,
      isToday: date === todaySast(),
      cashReceivedCents: cash.filter((p) => p.type !== PaymentType.REFUND).reduce((s, p) => s + p.amountCents, 0),
      cashRefundedCents: cash.filter((p) => p.type === PaymentType.REFUND).reduce((s, p) => s + p.amountCents, 0),
      expectedCashCents: cash.reduce((s, p) => s + signed(p), 0),
      eftVerifiedCents: eft.filter((p) => p.verified).reduce((s, p) => s + signed(p), 0),
      eftPendingCents: eft.filter((p) => !p.verified && p.type !== PaymentType.REFUND).reduce((s, p) => s + p.amountCents, 0),
      byStaff: [...byStaff.values()],
      payments: payments.map((p) => ({
        id: p.id,
        createdAt: p.createdAt,
        bookingId: p.booking.id,
        bookingReference: p.booking.reference,
        guestName: `${p.booking.guest.firstName} ${p.booking.guest.lastName}`,
        roomName: p.booking.room.name,
        type: p.type,
        method: p.method,
        amountCents: p.amountCents,
        reference: p.reference,
        verified: p.verified,
        voidedAt: p.voidedAt,
        voidReason: p.voidReason,
        recordedBy: p.recordedBy.name,
      })),
    };
  }
}

/** The UTC instant at which a SAST calendar day starts (SAST is UTC+2, no daylight saving). */
function sastStart(date: DateOnly) {
  return new Date(`${date}T00:00:00+02:00`);
}
