import { BadRequestException, Controller, Get, Module, Query, Res, StreamableFile } from '@nestjs/common';
import { BookingStatus, PaymentType, Role } from '@prisma/client';
import type { Response } from 'express';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { addDays, endOfMonthExclusive, fromDbDate, isDateOnly, startOfMonth, summariseBalance, todaySast, toDbDate } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';
import { RoomsModule, RoomsService } from '../rooms/rooms.module';
import { SettingsModule } from '../settings/settings.module';
import { toExcel, toPdf } from './reports.export';
import { ReportsService } from './reports.service';

function requireDate(value: string | undefined, name: string) {
  if (!isDateOnly(value)) throw new BadRequestException(`${name} must be a date in YYYY-MM-DD format`);
  return value;
}

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @OwnerOnly()
  @Get('summary')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.reports.summary(requireDate(from, 'from'), requireDate(to, 'to'));
  }

  /** Receptionists need this to chase deposits and balances. */
  @Get('outstanding')
  outstanding() {
    return this.reports.outstanding();
  }

  @Get('cash-up')
  cashUp(@Query('date') date?: string) {
    return this.reports.cashUp(date ? requireDate(date, 'date') : todaySast());
  }

  @OwnerOnly()
  @Get('export')
  async export(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthUser,
  ) {
    if (format !== 'xlsx' && format !== 'pdf') throw new BadRequestException('format must be xlsx or pdf');
    const data = await this.reports.summary(requireDate(from, 'from'), requireDate(to, 'to'));
    const buffer = format === 'xlsx' ? await toExcel(data) : await toPdf(data);
    await this.audit.log(user.id, 'EXPORT', 'Report', null, { from, to, format });
    res.set({
      'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      'Content-Disposition': `attachment; filename="bnb-report-${from}-to-${to}.${format}"`,
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(buffer);
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly reports: ReportsService,
  ) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    const today = todaySast();
    const monthStart = startOfMonth(today);
    const monthEnd = endOfMonthExclusive(today);
    const weekAhead = addDays(today, 7);
    const activeStatuses = [BookingStatus.PENDING, BookingStatus.CONFIRMED];
    const guestSelect = { select: { firstName: true, lastName: true, phone: true } };
    const roomSelect = { select: { name: true } };

    const [rooms, arrivals, departures, inHouse, upcoming, outstanding, todaysPayments, monthPayments, bookingsToday, bookingsMonth, pendingEft] =
      await Promise.all([
        this.rooms.list(),
        this.prisma.booking.findMany({
          where: { checkIn: toDbDate(today), status: { in: [...activeStatuses, BookingStatus.CHECKED_IN] } },
          include: { guest: guestSelect, room: roomSelect, payments: true },
          orderBy: { room: { name: 'asc' } },
        }),
        this.prisma.booking.findMany({
          where: {
            OR: [
              { checkOut: toDbDate(today), status: { in: [BookingStatus.CHECKED_IN, BookingStatus.CHECKED_OUT] } },
              // Overstayed guests who were never checked out
              { checkOut: { lt: toDbDate(today) }, status: BookingStatus.CHECKED_IN },
            ],
          },
          include: { guest: guestSelect, room: roomSelect, payments: true },
          orderBy: { room: { name: 'asc' } },
        }),
        this.prisma.booking.count({ where: { status: BookingStatus.CHECKED_IN } }),
        this.prisma.booking.findMany({
          where: { checkIn: { gt: toDbDate(today), lte: toDbDate(weekAhead) }, status: { in: activeStatuses } },
          include: { guest: guestSelect, room: roomSelect, payments: true },
          orderBy: { checkIn: 'asc' },
          take: 20,
        }),
        this.reports.outstanding(),
        this.prisma.payment.findMany({ where: { paymentDate: toDbDate(today), voidedAt: null, verified: true } }),
        this.prisma.payment.findMany({
          where: { paymentDate: { gte: toDbDate(monthStart), lt: toDbDate(monthEnd) }, voidedAt: null, verified: true },
        }),
        this.prisma.booking.count({ where: { createdAt: { gte: new Date(`${today}T00:00:00+02:00`) } } }),
        this.prisma.booking.count({ where: { createdAt: { gte: new Date(`${monthStart}T00:00:00+02:00`) }, status: { not: BookingStatus.CANCELLED } } }),
        this.prisma.payment.count({ where: { verified: false, voidedAt: null } }),
      ]);

    const sum = (ps: { type: PaymentType; amountCents: number }[]) =>
      ps.reduce((s, p) => s + (p.type === PaymentType.REFUND ? -p.amountCents : p.amountCents), 0);
    const row = (b: (typeof arrivals)[number]) => ({
      id: b.id,
      reference: b.reference,
      status: b.status,
      checkIn: fromDbDate(b.checkIn),
      checkOut: fromDbDate(b.checkOut),
      guestName: `${b.guest.firstName} ${b.guest.lastName}`,
      guestPhone: b.guest.phone,
      roomName: b.room.name,
      adults: b.adults,
      children: b.children,
      balance: summariseBalance(b, b.payments),
    });
    const count = (s: string) => rooms.filter((r) => r.effectiveStatus === s).length;
    const owing = outstanding.filter((o) => o.outstandingCents > 0);

    return {
      today,
      rooms: {
        total: rooms.length,
        available: count('AVAILABLE'),
        booked: count('BOOKED'),
        occupied: count('OCCUPIED'),
        cleaning: count('CLEANING'),
        maintenance: count('MAINTENANCE'),
        list: rooms,
      },
      inHouse,
      arrivals: arrivals.map(row),
      departures: departures.map(row),
      upcoming: upcoming.map(row),
      outstanding: {
        depositsCount: owing.filter((o) => o.depositOutstandingCents > 0 && o.status !== BookingStatus.CHECKED_OUT).length,
        depositsCents: owing.reduce((s, o) => s + (o.status === BookingStatus.CHECKED_OUT ? 0 : o.depositOutstandingCents), 0),
        balancesCount: owing.length,
        balancesCents: owing.reduce((s, o) => s + o.outstandingCents, 0),
        refundsDueCount: outstanding.filter((o) => o.paymentStatus === 'REFUND_DUE').length,
        pendingEftCount: pendingEft,
        list: outstanding.slice(0, 10),
      },
      bookings: { today: bookingsToday, thisMonth: bookingsMonth },
      payments: {
        todayCents: sum(todaysPayments),
        // Monthly revenue is owner-only information.
        monthCents: user.role === Role.OWNER ? sum(monthPayments) : null,
      },
    };
  }
}

@Module({
  imports: [SettingsModule, RoomsModule],
  controllers: [ReportsController, DashboardController],
  providers: [ReportsService],
})
export class ReportsModule {}
