import { Prisma } from '@prisma/client';
import { fromDbDate, summariseBalance } from '../common/domain';

export const paymentInclude = {
  recordedBy: { select: { id: true, name: true } },
  verifiedBy: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

export const bookingInclude = {
  guest: true,
  room: { select: { id: true, name: true, pricePerNightCents: true, maxGuests: true } },
  payments: { include: paymentInclude, orderBy: { createdAt: 'asc' } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
} satisfies Prisma.BookingInclude;

export type BookingWithRelations = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;
export type PaymentWithRelations = Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>;

export function toPaymentDto(p: PaymentWithRelations | Prisma.PaymentGetPayload<object>) {
  const { proofFilePath, ...rest } = p as PaymentWithRelations;
  return { ...rest, paymentDate: fromDbDate(p.paymentDate), hasProof: !!proofFilePath };
}

export function toBookingDto(b: BookingWithRelations) {
  return {
    ...b,
    checkIn: fromDbDate(b.checkIn),
    checkOut: fromDbDate(b.checkOut),
    payments: b.payments.map(toPaymentDto),
    balance: summariseBalance(b, b.payments),
  };
}
