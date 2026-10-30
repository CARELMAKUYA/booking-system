import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { BookingStatus, Prisma } from '@prisma/client';
import { IsBoolean, IsEmail, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, OwnerOnly } from '../common/decorators';
import { normalisePhone } from '../common/domain';
import { PrismaService } from '../prisma/prisma.service';
import { bookingInclude, toBookingDto } from '../bookings/booking.mapper';

export class GuestInputDto {
  @IsString() @MinLength(1) @MaxLength(60) firstName: string;
  @IsString() @MinLength(1) @MaxLength(60) lastName: string;
  @IsString() @MinLength(9) @MaxLength(25) phone: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() email?: string | null;
  @IsOptional() @IsString() @MaxLength(20) vehicleReg?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsBoolean() consentGiven?: boolean;
}

class UpdateGuestDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60) lastName?: string;
  @IsOptional() @IsString() @MinLength(9) @MaxLength(25) phone?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null && v !== '') @IsEmail() email?: string | null;
  @IsOptional() @IsString() @MaxLength(20) vehicleReg?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional() @IsBoolean() consentGiven?: boolean;
}

@Injectable()
export class GuestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Validates and normalises guest fields for create or update. */
  clean<T extends Partial<GuestInputDto>>(dto: T) {
    const out: Prisma.GuestUpdateInput = {};
    if (dto.firstName !== undefined) out.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) out.lastName = dto.lastName.trim();
    if (dto.phone !== undefined) {
      const phone = normalisePhone(dto.phone);
      if (!phone) throw new BadRequestException('Enter a valid South African phone number, e.g. 082 123 4567 or +27 82 123 4567');
      out.phone = phone;
    }
    if (dto.email !== undefined) out.email = dto.email ? dto.email.trim().toLowerCase() : null;
    if (dto.vehicleReg !== undefined) out.vehicleReg = dto.vehicleReg ? dto.vehicleReg.trim().toUpperCase() : null;
    if (dto.notes !== undefined) out.notes = dto.notes?.trim() || null;
    if (dto.consentGiven !== undefined) {
      out.consentGiven = dto.consentGiven;
      out.consentAt = dto.consentGiven ? new Date() : null;
    }
    return out;
  }

  async create(dto: GuestInputDto, userId: string, tx?: Prisma.TransactionClient) {
    const guest = await (tx ?? this.prisma).guest.create({ data: this.clean(dto) as Prisma.GuestCreateInput });
    await this.audit.log(userId, 'CREATE', 'Guest', guest.id, undefined, tx);
    return guest;
  }
}

@Controller('guests')
export class GuestsController {
  constructor(
    private readonly guests: GuestsService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query('q') q?: string, @Query('take') take?: string) {
    const term = q?.trim();
    // Phones are stored as +27XXXXXXXXX, so match partial input like "082 333" on its digits without the trunk 0.
    const phoneDigits = term ? (normalisePhone(term) ?? term.replace(/\D/g, '').replace(/^0/, '')) : '';
    const where: Prisma.GuestWhereInput = term
      ? {
          anonymisedAt: null,
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            { vehicleReg: { contains: term, mode: 'insensitive' } },
            ...(phoneDigits.length >= 3 ? [{ phone: { contains: phoneDigits } }] : []),
            ...(term.includes(' ')
              ? [
                  {
                    firstName: { contains: term.split(' ')[0], mode: 'insensitive' as const },
                    lastName: { contains: term.split(' ').slice(1).join(' '), mode: 'insensitive' as const },
                  },
                ]
              : []),
          ],
        }
      : { anonymisedAt: null };

    const guests = await this.prisma.guest.findMany({
      where,
      take: Math.min(Number(take) || 100, 500),
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        bookings: {
          where: { status: { not: BookingStatus.CANCELLED } },
          select: { checkIn: true },
          orderBy: { checkIn: 'desc' },
        },
      },
    });
    return guests.map(({ bookings, ...g }) => ({
      ...g,
      stayCount: bookings.length,
      lastStay: bookings[0]?.checkIn.toISOString().slice(0, 10) ?? null,
    }));
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const guest = await this.prisma.guest.findUnique({
      where: { id },
      include: { bookings: { include: bookingInclude, orderBy: { checkIn: 'desc' } } },
    });
    if (!guest) throw new NotFoundException('Guest not found');
    // POPIA: record access to a guest's full profile.
    await this.audit.log(user.id, 'VIEW', 'Guest', id);
    return { ...guest, bookings: guest.bookings.map(toBookingDto) };
  }

  @Post()
  create(@Body() dto: GuestInputDto, @CurrentUser() user: AuthUser) {
    return this.guests.create(dto, user.id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateGuestDto, @CurrentUser() user: AuthUser) {
    const guest = await this.prisma.guest.findUniqueOrThrow({ where: { id } });
    if (guest.anonymisedAt) throw new BadRequestException('This guest record has been anonymised');
    const updated = await this.prisma.guest.update({ where: { id }, data: this.guests.clean(dto) });
    await this.audit.log(user.id, 'UPDATE', 'Guest', id, { fields: Object.keys(dto) });
    return updated;
  }

  /**
   * POPIA right to erasure: removes personal information but keeps the booking and
   * payment records needed for financial/tax purposes.
   */
  @OwnerOnly()
  @Post(':id/anonymise')
  async anonymise(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const active = await this.prisma.booking.count({
      where: { guestId: id, status: { in: [BookingStatus.PENDING, BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN] } },
    });
    if (active) throw new BadRequestException('This guest has active bookings. Complete or cancel them first.');
    const guest = await this.prisma.guest.update({
      where: { id },
      data: {
        firstName: 'Anonymised',
        lastName: 'Guest',
        phone: '',
        email: null,
        vehicleReg: null,
        notes: null,
        anonymisedAt: new Date(),
      },
    });
    await this.prisma.booking.updateMany({ where: { guestId: id }, data: { specialRequests: null } });
    await this.audit.log(user.id, 'ANONYMISE', 'Guest', id);
    return guest;
  }
}

@Module({ controllers: [GuestsController], providers: [GuestsService], exports: [GuestsService] })
export class GuestsModule {}
