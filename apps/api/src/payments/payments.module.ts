import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BookingStatus, PaymentMethod, PaymentType, Prisma, Role } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser } from '../common/decorators';
import { summariseBalance, todaySast, toDbDate } from '../common/domain';
import { IsDateOnly } from '../common/validation';
import { PrismaService } from '../prisma/prisma.service';
import { paymentInclude, toPaymentDto } from '../bookings/booking.mapper';

// Serverless hosts like Vercel only allow writes to the temp folder, and files there don't persist.
const UPLOAD_DIR = resolve(process.env.UPLOAD_DIR ?? (process.env.VERCEL ? join(tmpdir(), 'uploads') : './uploads'));
const ALLOWED_PROOF_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const proofUpload = FileInterceptor('proof', {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      mkdirSync(UPLOAD_DIR, { recursive: true });
      cb(null, UPLOAD_DIR);
    },
    // Random names: never trust or reuse the uploaded filename on disk.
    filename: (_req, file, cb) => cb(null, `${randomUUID()}${ALLOWED_PROOF_TYPES[file.mimetype] ?? extname(file.originalname)}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_PROOF_TYPES[file.mimetype]) cb(null, true);
    else cb(new BadRequestException('Proof of payment must be a PDF, JPG, PNG or WEBP file'), false);
  },
});

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true';

class RecordPaymentDto {
  @IsEnum(PaymentType) type: PaymentType;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @Type(() => Number) @IsInt() @Min(1) @Max(100_000_000) amountCents: number;
  @IsDateOnly() paymentDate: string;
  @IsOptional() @IsString() @MaxLength(100) reference?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
  /** For EFT: tick only once the money is visible in the BnB's bank account. */
  @IsOptional() @Transform(toBool) @IsBoolean() fundsConfirmed?: boolean;
}

class VoidPaymentDto {
  @IsString() @MinLength(3) @MaxLength(300) reason: string;
}

@Controller()
export class PaymentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('payments')
  async list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('method') method?: PaymentMethod,
    @Query('verified') verified?: string,
  ) {
    const where: Prisma.PaymentWhereInput = { voidedAt: null };
    if (from || to) where.paymentDate = { ...(from && { gte: toDbDate(from) }), ...(to && { lte: toDbDate(to) }) };
    if (method) where.method = method;
    if (verified !== undefined) where.verified = verified === 'true';
    const payments = await this.prisma.payment.findMany({
      where,
      include: {
        ...paymentInclude,
        booking: { select: { id: true, reference: true, guest: { select: { firstName: true, lastName: true } }, room: { select: { name: true } } } },
      },
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    return payments.map(toPaymentDto);
  }

  @Post('bookings/:bookingId/payments')
  @UseInterceptors(proofUpload)
  async record(
    @Param('bookingId') bookingId: string,
    @Body() dto: RecordPaymentDto,
    @UploadedFile() proof: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    const booking = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: { payments: true } });
    if (!booking) throw new NotFoundException('Booking not found');
    if (dto.paymentDate > todaySast()) throw new BadRequestException('Payment date cannot be in the future');

    const balance = summariseBalance(booking, booking.payments);
    if (dto.type === PaymentType.REFUND) {
      if (dto.amountCents > balance.paidCents) {
        throw new BadRequestException('A refund cannot be more than the verified amount the guest has paid');
      }
    } else if (booking.status === BookingStatus.CANCELLED && dto.amountCents > balance.outstandingCents) {
      throw new BadRequestException('This booking is cancelled. Only the cancellation fee can still be collected.');
    }

    // Cash is counted on receipt. EFT is only verified once funds are confirmed in the bank.
    const verified = dto.method === PaymentMethod.CASH || !!dto.fundsConfirmed;
    const payment = await this.prisma.payment.create({
      data: {
        bookingId,
        type: dto.type,
        method: dto.method,
        amountCents: dto.amountCents,
        paymentDate: toDbDate(dto.paymentDate),
        reference: dto.reference?.trim() || null,
        notes: dto.notes?.trim() || null,
        verified,
        verifiedAt: verified ? new Date() : null,
        verifiedById: verified ? user.id : null,
        recordedById: user.id,
        ...(proof && { proofFileName: proof.originalname.slice(0, 200), proofFilePath: proof.filename, proofMimeType: proof.mimetype }),
      },
      include: paymentInclude,
    });
    // A deposit secures a pending booking.
    if (verified && dto.type === PaymentType.DEPOSIT && booking.status === BookingStatus.PENDING) {
      await this.prisma.booking.update({ where: { id: bookingId }, data: { status: BookingStatus.CONFIRMED, updatedById: user.id } });
    }
    await this.audit.log(user.id, 'CREATE', 'Payment', payment.id, {
      booking: booking.reference,
      type: dto.type,
      method: dto.method,
      amountCents: dto.amountCents,
      verified,
    });
    return toPaymentDto(payment);
  }

  @Post('payments/:id/verify')
  @HttpCode(200)
  async verify(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: { booking: true } });
    if (payment.voidedAt) throw new BadRequestException('This payment was voided');
    if (payment.verified) throw new BadRequestException('This payment is already verified');
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { verified: true, verifiedAt: new Date(), verifiedById: user.id },
      include: paymentInclude,
    });
    if (payment.type === PaymentType.DEPOSIT && payment.booking.status === BookingStatus.PENDING) {
      await this.prisma.booking.update({ where: { id: payment.bookingId }, data: { status: BookingStatus.CONFIRMED, updatedById: user.id } });
    }
    await this.audit.log(user.id, 'VERIFY', 'Payment', id, { amountCents: payment.amountCents, reference: payment.reference });
    return toPaymentDto(updated);
  }

  /** Payments are never deleted; mistakes are voided with a reason so the cash-up stays auditable. */
  @Post('payments/:id/void')
  @HttpCode(200)
  async void(@Param('id') id: string, @Body() dto: VoidPaymentDto, @CurrentUser() user: AuthUser) {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    if (payment.voidedAt) throw new BadRequestException('This payment is already voided');
    // Receptionists may only void same-day entries (e.g. typing errors); older ones need the owner.
    if (user.role !== Role.OWNER && todaySast(payment.createdAt) !== todaySast()) {
      throw new BadRequestException('Only the owner can void a payment recorded on a previous day');
    }
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { voidedAt: new Date(), voidReason: dto.reason.trim() },
      include: paymentInclude,
    });
    await this.audit.log(user.id, 'VOID', 'Payment', id, { amountCents: payment.amountCents, reason: dto.reason });
    return toPaymentDto(updated);
  }

  @Post('payments/:id/proof')
  @UseInterceptors(proofUpload)
  async attachProof(@Param('id') id: string, @UploadedFile() proof: Express.Multer.File | undefined, @CurrentUser() user: AuthUser) {
    if (!proof) throw new BadRequestException('Choose a file to upload');
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { proofFileName: proof.originalname.slice(0, 200), proofFilePath: proof.filename, proofMimeType: proof.mimetype },
      include: paymentInclude,
    });
    await this.audit.log(user.id, 'ATTACH_PROOF', 'Payment', id);
    return toPaymentDto(updated);
  }

  @Get('payments/:id/proof')
  async proof(@Param('id') id: string, @Res({ passthrough: true }) res: Response, @CurrentUser() user: AuthUser) {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment?.proofFilePath) throw new NotFoundException('No proof of payment uploaded');
    const path = join(UPLOAD_DIR, payment.proofFilePath);
    if (!path.startsWith(UPLOAD_DIR) || !existsSync(path)) throw new NotFoundException('File is missing');
    await this.audit.log(user.id, 'VIEW_PROOF', 'Payment', id);
    res.set({
      'Content-Type': payment.proofMimeType ?? 'application/octet-stream',
      'Content-Disposition': `inline; filename="${(payment.proofFileName ?? 'proof').replace(/[^\w.\- ]/g, '_')}"`,
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(createReadStream(path));
  }
}

@Module({ controllers: [PaymentsController] })
export class PaymentsModule {}
