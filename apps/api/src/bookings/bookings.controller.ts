import { BadRequestException, Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { BookingSource, BookingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { isDateOnly } from '../common/domain';
import { IsDateOnly } from '../common/validation';
import { GuestInputDto, GuestsModule } from '../guests/guests.module';
import { SettingsModule } from '../settings/settings.module';
import { BookingsService } from './bookings.service';

class CreateBookingDto {
  @IsOptional() @IsString() guestId?: string;
  @IsOptional() @ValidateNested() @Type(() => GuestInputDto) guest?: GuestInputDto;
  @IsString() roomId: string;
  @IsDateOnly() checkIn: string;
  @IsDateOnly() checkOut: string;
  @IsInt() @Min(1) @Max(20) adults: number;
  @IsInt() @Min(0) @Max(20) children: number;
  @IsEnum(BookingSource) source: BookingSource;
  @IsOptional() @IsEnum(BookingStatus) status?: BookingStatus;
  @IsOptional() @IsInt() @Min(0) nightlyRateCents?: number;
  @IsOptional() @IsInt() @Min(0) depositRequiredCents?: number;
  @IsOptional() @IsString() @MaxLength(2000) specialRequests?: string;
  @IsOptional() @IsString() @MaxLength(2000) internalNotes?: string;
}

class UpdateBookingDto {
  @IsOptional() @IsString() roomId?: string;
  @IsOptional() @IsDateOnly() checkIn?: string;
  @IsOptional() @IsDateOnly() checkOut?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) adults?: number;
  @IsOptional() @IsInt() @Min(0) @Max(20) children?: number;
  @IsOptional() @IsEnum(BookingSource) source?: BookingSource;
  @IsOptional() @IsEnum(BookingStatus) status?: BookingStatus;
  @IsOptional() @IsInt() @Min(0) nightlyRateCents?: number;
  @IsOptional() @IsInt() @Min(0) depositRequiredCents?: number;
  @IsOptional() @IsString() @MaxLength(2000) specialRequests?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) internalNotes?: string | null;
}

class ExtendBookingDto {
  @IsDateOnly() checkOut: string;
}

class CancelBookingDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsInt() @Min(0) cancellationFeeCents?: number;
}

class CheckOutDto {
  @IsOptional() @IsBoolean() acknowledgeBalance?: boolean;
}

function requireDate(value: string | undefined, name: string) {
  if (!isDateOnly(value)) throw new BadRequestException(`${name} must be a date in YYYY-MM-DD format`);
  return value;
}

@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get('bookings')
  list(
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('q') q?: string,
    @Query('paymentStatus') paymentStatus?: string,
    @Query('roomId') roomId?: string,
  ) {
    return this.bookings.list({
      status,
      from: from ? requireDate(from, 'from') : undefined,
      to: to ? requireDate(to, 'to') : undefined,
      q,
      paymentStatus,
      roomId,
    });
  }

  @Get('bookings/availability')
  availability(@Query('checkIn') checkIn?: string, @Query('checkOut') checkOut?: string, @Query('excludeBookingId') exclude?: string) {
    return this.bookings.availability(requireDate(checkIn, 'checkIn'), requireDate(checkOut, 'checkOut'), exclude);
  }

  @Get('calendar')
  calendar(@Query('from') from?: string, @Query('to') to?: string) {
    return this.bookings.calendar(requireDate(from, 'from'), requireDate(to, 'to'));
  }

  @Get('bookings/:id')
  get(@Param('id') id: string) {
    return this.bookings.get(id);
  }

  @Post('bookings')
  create(@Body() dto: CreateBookingDto, @CurrentUser() user: AuthUser) {
    return this.bookings.create(dto, user);
  }

  @Patch('bookings/:id')
  update(@Param('id') id: string, @Body() dto: UpdateBookingDto, @CurrentUser() user: AuthUser) {
    return this.bookings.update(id, dto, user);
  }

  @Post('bookings/:id/extend')
  @HttpCode(200)
  extend(@Param('id') id: string, @Body() dto: ExtendBookingDto, @CurrentUser() user: AuthUser) {
    return this.bookings.update(id, { checkOut: dto.checkOut }, user);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() dto: CancelBookingDto, @CurrentUser() user: AuthUser) {
    return this.bookings.cancel(id, dto.reason, dto.cancellationFeeCents ?? 0, user);
  }

  @Post('bookings/:id/check-in')
  @HttpCode(200)
  checkIn(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.bookings.checkIn(id, user);
  }

  @Post('bookings/:id/check-out')
  @HttpCode(200)
  checkOut(@Param('id') id: string, @Body() dto: CheckOutDto, @CurrentUser() user: AuthUser) {
    return this.bookings.checkOut(id, !!dto.acknowledgeBalance, user);
  }
}

@Module({
  imports: [GuestsModule, SettingsModule],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
