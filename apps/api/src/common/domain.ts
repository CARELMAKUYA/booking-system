/**
 * Pure business rules shared across modules. Kept free of Nest/Prisma so they
 * can be unit tested directly.
 */

export const TIME_ZONE = 'Africa/Johannesburg';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date as `YYYY-MM-DD`. */
export type DateOnly = string;

export function isDateOnly(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
}

/** Today's date in SAST. */
export function todaySast(now: Date = new Date()): DateOnly {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Converts a `YYYY-MM-DD` string to the UTC-midnight Date Prisma uses for `@db.Date`. */
export function toDbDate(value: DateOnly): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function fromDbDate(value: Date): DateOnly {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: DateOnly, days: number): DateOnly {
  const d = toDbDate(value);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: DateOnly, to: DateOnly): number {
  return Math.round((toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000);
}

export function startOfMonth(value: DateOnly): DateOnly {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonthExclusive(value: DateOnly): DateOnly {
  const d = toDbDate(startOfMonth(value));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return fromDbDate(d);
}

/** Monday of the week containing `value`. */
export function startOfWeek(value: DateOnly): DateOnly {
  const dow = toDbDate(value).getUTCDay(); // 0 = Sunday
  return addDays(value, dow === 0 ? -6 : 1 - dow);
}

/** Half-open date ranges [aStart, aEnd) and [bStart, bEnd) overlap. */
export function rangesOverlap(aStart: DateOnly, aEnd: DateOnly, bStart: DateOnly, bEnd: DateOnly): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** VAT contained in a VAT-inclusive amount, e.g. 15% => amount * 15 / 115. */
export function vatFromInclusive(amountCents: number, vatRateBps: number): number {
  if (vatRateBps <= 0) return 0;
  return Math.round((amountCents * vatRateBps) / (10_000 + vatRateBps));
}

export interface BookingPricing {
  nights: number;
  totalCents: number;
  vatCents: number;
  depositRequiredCents: number;
}

export function priceBooking(input: {
  checkIn: DateOnly;
  checkOut: DateOnly;
  nightlyRateCents: number;
  vatRegistered: boolean;
  vatRateBps: number;
  depositPercent: number;
}): BookingPricing {
  const nights = diffDays(input.checkIn, input.checkOut);
  if (nights < 1) throw new Error('Check-out must be at least one night after check-in');
  const totalCents = nights * input.nightlyRateCents;
  return {
    nights,
    totalCents,
    vatCents: input.vatRegistered ? vatFromInclusive(totalCents, input.vatRateBps) : 0,
    depositRequiredCents: roundToRand((totalCents * input.depositPercent) / 100),
  };
}

/** Rounds cents to the nearest whole Rand. */
export function roundToRand(cents: number): number {
  return Math.round(cents / 100) * 100;
}

export type PaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'FULLY_PAID' | 'REFUND_DUE';

export interface PaymentLike {
  type: 'DEPOSIT' | 'PAYMENT' | 'REFUND';
  amountCents: number;
  verified: boolean;
  voidedAt?: Date | null;
}

export interface BalanceSummary {
  /** What the guest owes: the booking total, or the cancellation fee if cancelled. */
  amountDueCents: number;
  /** Verified money in, less refunds paid out. */
  paidCents: number;
  /** EFT payments recorded but not yet confirmed. */
  pendingVerificationCents: number;
  /** Outstanding Balance = Total Booking Cost − Total Payments Received. Negative means a refund is owed. */
  outstandingCents: number;
  depositOutstandingCents: number;
  paymentStatus: PaymentStatus;
}

export function summariseBalance(
  booking: { totalCents: number; depositRequiredCents: number; status: string; cancellationFeeCents?: number | null },
  payments: PaymentLike[],
): BalanceSummary {
  const live = payments.filter((p) => !p.voidedAt);
  let paidCents = 0;
  let pendingVerificationCents = 0;
  for (const p of live) {
    const signed = p.type === 'REFUND' ? -p.amountCents : p.amountCents;
    if (p.verified) paidCents += signed;
    else if (p.type !== 'REFUND') pendingVerificationCents += p.amountCents;
  }

  const amountDueCents =
    booking.status === 'CANCELLED' ? booking.cancellationFeeCents ?? 0 : booking.totalCents;
  const outstandingCents = amountDueCents - paidCents;
  const depositOutstandingCents =
    booking.status === 'CANCELLED' ? 0 : Math.max(0, Math.min(booking.depositRequiredCents, amountDueCents) - paidCents);

  let paymentStatus: PaymentStatus;
  if (outstandingCents < 0) paymentStatus = 'REFUND_DUE';
  else if (amountDueCents > 0 && outstandingCents === 0) paymentStatus = 'FULLY_PAID';
  else if (amountDueCents === 0) paymentStatus = paidCents === 0 ? 'FULLY_PAID' : 'REFUND_DUE';
  else if (paidCents > 0) paymentStatus = 'PARTIALLY_PAID';
  else paymentStatus = 'UNPAID';

  return { amountDueCents, paidCents, pendingVerificationCents, outstandingCents, depositOutstandingCents, paymentStatus };
}

/**
 * Normalises a South African phone number to E.164 (+27XXXXXXXXX).
 * Accepts "082 123 4567", "0821234567", "27821234567", "+27 82 123 4567".
 * Returns null when the number is not a valid SA number. International numbers
 * (starting with + but not +27) are kept as-is for foreign guests.
 */
export function normalisePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+') && !trimmed.startsWith('+27')) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  let national: string;
  if (digits.startsWith('27') && digits.length === 11) national = digits.slice(2);
  else if (digits.startsWith('0') && digits.length === 10) national = digits.slice(1);
  else if (digits.length === 9 && !digits.startsWith('0')) national = digits;
  else return null;
  return `+27${national}`;
}

/** Booking statuses that hold a room's dates. */
export const ACTIVE_BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'] as const;
