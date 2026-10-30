import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  diffDays,
  isDateOnly,
  normalisePhone,
  priceBooking,
  rangesOverlap,
  startOfWeek,
  summariseBalance,
  todaySast,
  vatFromInclusive,
} from '../src/common/domain';

test('todaySast uses Africa/Johannesburg (UTC+2)', () => {
  // 23:30 UTC on 31 Dec is already 1 Jan in SAST
  assert.equal(todaySast(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
  assert.equal(todaySast(new Date('2026-06-15T10:00:00Z')), '2026-06-15');
});

test('date helpers', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(diffDays('2026-10-30', '2026-11-02'), 3);
  assert.equal(startOfWeek('2026-11-01'), '2026-10-26'); // Sunday -> previous Monday
  assert.equal(startOfWeek('2026-10-26'), '2026-10-26');
  assert.ok(isDateOnly('2026-02-28'));
  assert.ok(!isDateOnly('2026-02-30'));
  assert.ok(!isDateOnly('30/10/2026'));
});

test('overlap treats check-out day as free for the next arrival', () => {
  assert.equal(rangesOverlap('2026-11-01', '2026-11-03', '2026-11-03', '2026-11-05'), false);
  assert.equal(rangesOverlap('2026-11-01', '2026-11-04', '2026-11-03', '2026-11-05'), true);
  assert.equal(rangesOverlap('2026-11-02', '2026-11-03', '2026-11-01', '2026-11-05'), true);
});

test('VAT is extracted from inclusive amounts', () => {
  assert.equal(vatFromInclusive(115_000, 1500), 15_000);
  assert.equal(vatFromInclusive(100_000, 0), 0);
});

test('priceBooking', () => {
  const p = priceBooking({
    checkIn: '2026-12-20',
    checkOut: '2026-12-23',
    nightlyRateCents: 95_000,
    vatRegistered: true,
    vatRateBps: 1500,
    depositPercent: 50,
  });
  assert.deepEqual(p, { nights: 3, totalCents: 285_000, vatCents: 37_174, depositRequiredCents: 142_500 });
  assert.throws(() =>
    priceBooking({ checkIn: '2026-12-20', checkOut: '2026-12-20', nightlyRateCents: 1, vatRegistered: false, vatRateBps: 0, depositPercent: 0 }),
  );
});

test('summariseBalance: statuses and EFT verification', () => {
  const booking = { totalCents: 200_000, depositRequiredCents: 100_000, status: 'CONFIRMED' };
  assert.equal(summariseBalance(booking, []).paymentStatus, 'UNPAID');

  const unverifiedEft = summariseBalance(booking, [{ type: 'DEPOSIT', amountCents: 100_000, verified: false }]);
  assert.equal(unverifiedEft.paymentStatus, 'UNPAID');
  assert.equal(unverifiedEft.pendingVerificationCents, 100_000);
  assert.equal(unverifiedEft.outstandingCents, 200_000);

  const deposit = summariseBalance(booking, [{ type: 'DEPOSIT', amountCents: 100_000, verified: true }]);
  assert.equal(deposit.paymentStatus, 'PARTIALLY_PAID');
  assert.equal(deposit.outstandingCents, 100_000);
  assert.equal(deposit.depositOutstandingCents, 0);

  const full = summariseBalance(booking, [
    { type: 'DEPOSIT', amountCents: 100_000, verified: true },
    { type: 'PAYMENT', amountCents: 100_000, verified: true },
    { type: 'PAYMENT', amountCents: 50_000, verified: true, voidedAt: new Date() },
  ]);
  assert.equal(full.paymentStatus, 'FULLY_PAID');
  assert.equal(full.outstandingCents, 0);
});

test('summariseBalance: cancellation leads to refund due, then settled', () => {
  const cancelled = { totalCents: 200_000, depositRequiredCents: 100_000, status: 'CANCELLED', cancellationFeeCents: 20_000 };
  const paid = [{ type: 'DEPOSIT' as const, amountCents: 100_000, verified: true }];
  const s = summariseBalance(cancelled, paid);
  assert.equal(s.paymentStatus, 'REFUND_DUE');
  assert.equal(s.outstandingCents, -80_000);

  const refunded = summariseBalance(cancelled, [...paid, { type: 'REFUND', amountCents: 80_000, verified: true }]);
  assert.equal(refunded.paymentStatus, 'FULLY_PAID');
  assert.equal(refunded.outstandingCents, 0);
});

test('normalisePhone handles South African formats', () => {
  assert.equal(normalisePhone('082 123 4567'), '+27821234567');
  assert.equal(normalisePhone('+27 82 123 4567'), '+27821234567');
  assert.equal(normalisePhone('27821234567'), '+27821234567');
  assert.equal(normalisePhone('(041) 585-1234'), '+27415851234');
  assert.equal(normalisePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalisePhone('12345'), null);
});
