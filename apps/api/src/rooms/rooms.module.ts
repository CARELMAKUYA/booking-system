import { BadRequestException, Body, Controller, Get, Injectable, Module, Param, Patch, Post } from '@nestjs/common';
import { BookingStatus, RoomStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { fromDbDate, todaySast, toDbDate } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';

class CreateRoomDto {
  @IsString() @MinLength(1) @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsInt() @Min(0) @Max(10_000_000) pricePerNightCents: number;
  @IsInt() @Min(1) @Max(20) maxGuests: number;
  @IsOptional() @IsInt() sortOrder?: number;
}

class UpdateRoomDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(10_000_000) pricePerNightCents?: number;
  @IsOptional() @IsInt() @Min(1) @Max(20) maxGuests?: number;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}

// BOOKED and OCCUPIED follow from bookings, so staff set only housekeeping states by hand.
const MANUAL_STATUSES = [RoomStatus.AVAILABLE, RoomStatus.CLEANING, RoomStatus.MAINTENANCE] as const;

class UpdateRoomStatusDto {
  @IsEnum(RoomStatus)
  @IsIn(MANUAL_STATUSES as unknown as string[], { message: 'Status must be Available, Cleaning or Maintenance' })
  status: RoomStatus;
}

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Rooms with today's effective status and current/next guest. */
  async list(includeInactive = false) {
    const today = toDbDate(todaySast());
    const rooms = await this.prisma.room.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        bookings: {
          where: {
            OR: [
              { status: BookingStatus.CHECKED_IN },
              {
                status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED] },
                checkIn: { lte: today },
                checkOut: { gt: today },
              },
            ],
          },
          orderBy: { checkIn: 'asc' },
          select: {
            id: true,
            reference: true,
            status: true,
            checkIn: true,
            checkOut: true,
            guest: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });

    return rooms.map(({ bookings, ...room }) => {
      const current = bookings.find((b) => b.status === BookingStatus.CHECKED_IN) ?? bookings[0] ?? null;
      let effectiveStatus: RoomStatus = room.status;
      if (bookings.some((b) => b.status === BookingStatus.CHECKED_IN)) effectiveStatus = RoomStatus.OCCUPIED;
      else if (room.status === RoomStatus.AVAILABLE && bookings.length > 0) effectiveStatus = RoomStatus.BOOKED;
      else if (room.status === RoomStatus.OCCUPIED) effectiveStatus = RoomStatus.AVAILABLE; // stale: nobody checked in
      return {
        ...room,
        effectiveStatus,
        currentBooking: current && {
          id: current.id,
          reference: current.reference,
          status: current.status,
          checkIn: fromDbDate(current.checkIn),
          checkOut: fromDbDate(current.checkOut),
          guestName: `${current.guest.firstName} ${current.guest.lastName}`,
        },
      };
    });
  }
}

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.rooms.list(false);
  }

  @Get('all')
  listAll() {
    return this.rooms.list(true);
  }

  @OwnerOnly()
  @Post()
  async create(@Body() dto: CreateRoomDto, @CurrentUser() user: AuthUser) {
    await this.assertNameFree(dto.name);
    const room = await this.prisma.room.create({ data: { ...dto, name: dto.name.trim() } });
    await this.audit.log(user.id, 'CREATE', 'Room', room.id, { name: room.name, price: room.pricePerNightCents });
    return room;
  }

  @OwnerOnly()
  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateRoomDto, @CurrentUser() user: AuthUser) {
    if (dto.name) await this.assertNameFree(dto.name, id);
    const before = await this.prisma.room.findUniqueOrThrow({ where: { id } });
    const room = await this.prisma.room.update({ where: { id }, data: { ...dto, name: dto.name?.trim() } });
    await this.audit.log(user.id, 'UPDATE', 'Room', id, {
      ...dto,
      ...(dto.pricePerNightCents !== undefined ? { previousPrice: before.pricePerNightCents } : {}),
    });
    return room;
  }

  /** Receptionists use this to mark rooms clean / under maintenance. */
  @Patch(':id/status')
  async setStatus(@Param('id') id: string, @Body() dto: UpdateRoomStatusDto, @CurrentUser() user: AuthUser) {
    const occupied = await this.prisma.booking.count({ where: { roomId: id, status: BookingStatus.CHECKED_IN } });
    if (occupied && dto.status !== RoomStatus.MAINTENANCE) {
      throw new BadRequestException('A guest is checked in to this room. Check them out first.');
    }
    const room = await this.prisma.room.update({ where: { id }, data: { status: dto.status } });
    await this.audit.log(user.id, 'STATUS', 'Room', id, { status: dto.status });
    return room;
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const existing = await this.prisma.room.findFirst({
      where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    });
    if (existing) throw new BadRequestException(`A room named "${existing.name}" already exists`);
  }
}

@Module({ controllers: [RoomsController], providers: [RoomsService], exports: [RoomsService] })
export class RoomsModule {}
