/**
 * Seeds an owner and receptionist account, BnB settings, rooms and sample bookings.
 * Safe to re-run: it does nothing if any user already exists.
 */
import { BookingSource, BookingStatus, PaymentMethod, PaymentType, PrismaClient, Role, RoomStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { addDays, priceBooking, todaySast, toDbDate } from '../src/common/domain';

const prisma = new PrismaClient();

const OWNER = { name: 'BnB Owner', email: 'owner@bnb.local', password: 'Owner@12345' };
const RECEPTIONIST = { name: 'Front Desk', email: 'reception@bnb.local', password: 'Reception@123' };

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log('Database already has users, skipping seed.');
    return;
  }

  const [owner, receptionist] = await Promise.all(
    [
      { ...OWNER, role: Role.OWNER },
      { ...RECEPTIONIST, role: Role.RECEPTIONIST },
    ].map(async (u) =>
      prisma.user.create({ data: { name: u.name, email: u.email, role: u.role, passwordHash: await bcrypt.hash(u.password, 12) } }),
    ),
  );

  await prisma.settings.create({
    data: {
      id: 1,
      businessName: 'Aloe Ridge Guest House',
      address: '12 Marine Drive, Summerstrand, Gqeberha, 6001, Eastern Cape',
      phone: '+27415551234',
      email: 'stay@aloeridge.co.za',
      vatRegistered: false,
      vatRateBps: 1500,
      defaultDepositPercent: 50,
      bankDetails: 'Aloe Ridge Guest House\nFNB Cheque Account 62000000000\nBranch code 250655\nReference: your booking number',
    },
  });

  const roomData = [
    { name: 'Room 1 – Garden', pricePerNightCents: 95000, maxGuests: 2, description: 'Queen bed, garden view, en-suite shower' },
    { name: 'Room 2 – Garden', pricePerNightCents: 95000, maxGuests: 2, description: 'Twin beds, garden view, en-suite shower' },
    { name: 'Room 3 – Sea View', pricePerNightCents: 135000, maxGuests: 2, description: 'King bed, balcony with sea view, bath and shower' },
    { name: 'Room 4 – Family', pricePerNightCents: 165000, maxGuests: 4, description: 'Queen bed plus two singles, kitchenette' },
    { name: 'Room 5 – Honeymoon', pricePerNightCents: 180000, maxGuests: 2, description: 'King bed, private patio, spa bath' },
  ];
  const rooms = [];
  for (const [i, r] of roomData.entries()) rooms.push(await prisma.room.create({ data: { ...r, sortOrder: i + 1 } }));

  const guests = await Promise.all(
    [
      { firstName: 'Thandiwe', lastName: 'Nkosi', phone: '+27821234567', email: 'thandiwe.nkosi@example.co.za', vehicleReg: 'CA 123-456' },
      { firstName: 'Pieter', lastName: 'van der Merwe', phone: '+27834567890', email: 'pieter.vdm@example.co.za', vehicleReg: 'HGT 456 EC' },
      { firstName: 'Ayesha', lastName: 'Patel', phone: '+27725550101', email: null, vehicleReg: null },
      { firstName: 'Sipho', lastName: 'Mthembu', phone: '+27605550202', email: 'sipho.m@example.com', vehicleReg: 'ND 789-012' },
      { firstName: 'Megan', lastName: 'Smith', phone: '+447700900123', email: 'megan.smith@example.co.uk', vehicleReg: null },
      { firstName: 'Lwazi', lastName: 'Dlamini', phone: '+27795550303', email: null, vehicleReg: 'JHB 22 GP' },
    ].map((g) => prisma.guest.create({ data: { ...g, consentGiven: true, consentAt: new Date() } })),
  );

  const today = todaySast();
  type Seed = {
    guest: number; room: number; inOffset: number; nights: number; status: BookingStatus; source: BookingSource;
    adults?: number; children?: number; payments?: { type: PaymentType; method: PaymentMethod; pct: number; verified?: boolean; dayOffset?: number }[];
    notes?: string;
  };
  const seeds: Seed[] = [
    // In-house guests
    { guest: 0, room: 0, inOffset: -2, nights: 3, status: BookingStatus.CHECKED_IN, source: BookingSource.WHATSAPP,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -10 }] },
    { guest: 1, room: 3, inOffset: -1, nights: 4, status: BookingStatus.CHECKED_IN, source: BookingSource.PHONE, adults: 2, children: 2,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -14 }, { type: PaymentType.PAYMENT, method: PaymentMethod.CASH, pct: 50, dayOffset: -1 }],
      notes: 'Cot needed for the toddler' },
    // Arriving today
    { guest: 2, room: 2, inOffset: 0, nights: 2, status: BookingStatus.CONFIRMED, source: BookingSource.EMAIL,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -5 }], notes: 'Late arrival, around 20:00' },
    { guest: 3, room: 1, inOffset: 0, nights: 1, status: BookingStatus.PENDING, source: BookingSource.PHONE,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, verified: false, dayOffset: 0 }] },
    // Upcoming
    { guest: 4, room: 4, inOffset: 3, nights: 5, status: BookingStatus.CONFIRMED, source: BookingSource.EMAIL,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -20 }], notes: 'Anniversary – flowers in room please' },
    { guest: 5, room: 0, inOffset: 5, nights: 2, status: BookingStatus.PENDING, source: BookingSource.WHATSAPP },
    { guest: 0, room: 2, inOffset: 12, nights: 3, status: BookingStatus.CONFIRMED, source: BookingSource.WHATSAPP,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -2 }] },
    // Past stays (returning guests, reports)
    { guest: 0, room: 2, inOffset: -40, nights: 2, status: BookingStatus.CHECKED_OUT, source: BookingSource.PHONE,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -50 }, { type: PaymentType.PAYMENT, method: PaymentMethod.CASH, pct: 50, dayOffset: -38 }] },
    { guest: 3, room: 4, inOffset: -9, nights: 3, status: BookingStatus.CHECKED_OUT, source: BookingSource.WALK_IN,
      payments: [{ type: PaymentType.PAYMENT, method: PaymentMethod.CASH, pct: 100, dayOffset: -9 }] },
    { guest: 1, room: 1, inOffset: -6, nights: 2, status: BookingStatus.CHECKED_OUT, source: BookingSource.PHONE,
      payments: [{ type: PaymentType.DEPOSIT, method: PaymentMethod.EFT, pct: 50, dayOffset: -12 }] },
  ];

  let n = 0;
  for (const s of seeds) {
    const room = rooms[s.room];
    const checkIn = addDays(today, s.inOffset);
    const checkOut = addDays(checkIn, s.nights);
    const pricing = priceBooking({ checkIn, checkOut, nightlyRateCents: room.pricePerNightCents, vatRegistered: false, vatRateBps: 1500, depositPercent: 50 });
    const booking = await prisma.booking.create({
      data: {
        reference: `BK-DEMO${String(++n).padStart(2, '0')}`,
        guestId: guests[s.guest].id,
        roomId: room.id,
        checkIn: toDbDate(checkIn),
        checkOut: toDbDate(checkOut),
        adults: s.adults ?? 2,
        children: s.children ?? 0,
        status: s.status,
        source: s.source,
        nightlyRateCents: room.pricePerNightCents,
        nights: pricing.nights,
        totalCents: pricing.totalCents,
        depositRequiredCents: pricing.depositRequiredCents,
        specialRequests: s.notes,
        createdById: n % 2 ? receptionist.id : owner.id,
        actualCheckInAt: s.status === BookingStatus.CHECKED_IN || s.status === BookingStatus.CHECKED_OUT ? new Date(`${checkIn}T14:30:00+02:00`) : null,
        actualCheckOutAt: s.status === BookingStatus.CHECKED_OUT ? new Date(`${checkOut}T09:45:00+02:00`) : null,
      },
    });
    for (const p of s.payments ?? []) {
      const verified = p.verified ?? true;
      const paymentDate = addDays(today, Math.min(p.dayOffset ?? 0, 0));
      await prisma.payment.create({
        data: {
          bookingId: booking.id,
          type: p.type,
          method: p.method,
          amountCents: Math.round((pricing.totalCents * p.pct) / 100),
          paymentDate: toDbDate(paymentDate),
          reference: p.method === PaymentMethod.EFT ? booking.reference : null,
          verified,
          verifiedAt: verified ? new Date() : null,
          verifiedById: verified ? owner.id : null,
          recordedById: receptionist.id,
        },
      });
    }
    if (s.status === BookingStatus.CHECKED_IN) await prisma.room.update({ where: { id: room.id }, data: { status: RoomStatus.OCCUPIED } });
  }
  // A room just vacated this morning still needs cleaning.
  await prisma.room.update({ where: { id: rooms[4].id }, data: { status: RoomStatus.CLEANING } });

  console.log('Seed complete. Sign in with:');
  console.log(`  Owner:        ${OWNER.email} / ${OWNER.password}`);
  console.log(`  Receptionist: ${RECEPTIONIST.email} / ${RECEPTIONIST.password}`);
  console.log('Change these passwords in Settings before going live.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
