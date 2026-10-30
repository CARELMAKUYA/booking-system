# BnB Admin Booking System

Booking management for a small Bed & Breakfast in the Eastern Cape: rooms, guests, bookings, deposits and payments (cash and EFT), a booking calendar, check-in/check-out, and financial reports.

Built for South African use: ZAR (`R 1 234.50`), DD/MM/YYYY dates, SAST (Africa/Johannesburg), +27 phone numbers, optional VAT, and POPIA-minded handling of guest data.

## Stack

| Part | Tech |
| --- | --- |
| `apps/web` | Next.js 16 (App Router), React 19, Tailwind CSS 4, shadcn/ui (Base UI), TanStack Query |
| `apps/api` | NestJS 11, Prisma 6, PostgreSQL |
| Auth | Server-side sessions in Postgres, `httpOnly` cookie, bcrypt password hashes |

The browser only talks to the Next.js app. Next.js rewrites `/api/*` to the NestJS API, so the session cookie is first-party.

## Getting started

Requirements: Node 20+, PostgreSQL 14+ (the `btree_gist` extension must be available, which it is in standard installs and most managed hosts).

```bash
npm install
cp apps/api/.env.example apps/api/.env      # then set DATABASE_URL
npm run db:migrate                           # creates tables + the double-booking constraint
npm run db:seed                              # demo rooms, guests, bookings and two logins
npm run dev                                  # API on :4000, web on :3000
```

Open http://localhost:3000 and sign in:

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@bnb.local` | `Owner@12345` |
| Receptionist | `reception@bnb.local` | `Reception@123` |

**Change both passwords (Settings → Change your password) and the BnB details before real use.** To start from an empty database, delete the demo data with `npx prisma migrate reset` in `apps/api` (this wipes everything), then create your own owner account: run the seed once and change its email/password, or insert one manually.

Useful scripts (from the repo root): `npm run typecheck`, `npm run build`, `npm test -w api`.

## How it works

### Roles

| | Receptionist | Owner |
| --- | --- | --- |
| Bookings, guests, check-in/out | ✓ | ✓ |
| Record payments, verify EFT | ✓ | ✓ |
| Void a payment | same day only | ✓ |
| Room housekeeping status | ✓ | ✓ |
| Add rooms, change prices, override a booking's rate | | ✓ |
| Monthly revenue, reports, Excel/PDF export | | ✓ |
| Daily cash-up | ✓ | ✓ |
| Staff accounts, BnB settings, activity log | | ✓ |
| Erase a guest's personal information | | ✓ |

### Money

- All amounts are stored as integer cents.
- **Outstanding balance = amount due − verified payments received.** Amount due is the booking total, or the cancellation fee if the booking is cancelled.
- **Cash** counts as soon as it is recorded. **EFT** only counts once it is marked verified (funds confirmed in the bank). Unverified EFTs show as "awaiting verification" everywhere.
- Payment status: Unpaid, Partially paid, Fully paid, or Refund due (paid more than is owed, e.g. after a cancellation).
- A verified deposit automatically moves a Pending booking to Confirmed.
- Payments are never deleted. Mistakes are voided with a reason, so the cash-up stays auditable.
- Proof of payment (PDF/JPG/PNG/WEBP, max 5 MB) is stored in `apps/api/uploads/` under random filenames and is only served to signed-in staff.
- VAT: when enabled in Settings, room prices are treated as VAT-inclusive, and the VAT portion is shown on bookings and reports.

### Bookings

- Dates are nights: a stay from 01/11 to 03/11 is two nights, and the room is free again for a new arrival on 03/11.
- **Double bookings are impossible.** The API checks availability inside a serializable transaction, and PostgreSQL enforces an exclusion constraint (`booking_no_overlap`) on room + date range for every non-cancelled booking.
- Statuses: Pending → Confirmed → Checked in → Checked out, or Cancelled.
- Check-out shows the outstanding balance first, and the receptionist must confirm to check out with money still owing. The room is then marked for cleaning. An early departure frees the remaining nights. The amount owed doesn't change; the owner can edit the booking if a partial refund is agreed.
- Room status: Available / Cleaning / Maintenance are set by staff; Occupied (checked in) and Booked (arrival due today) are derived from bookings.

### POPIA

- Every route requires a signed-in staff session; sessions last 12 hours (`SESSION_TTL_HOURS`) and are extended while in use.
- Staff actions are recorded in an activity log, including who opened a guest's profile or a proof of payment.
- Guest consent is recorded with a timestamp.
- The owner can erase a guest's personal information on request. Booking and payment records are kept for financial purposes, without the guest's identity.
- Login is rate-limited, and passwords are hashed with bcrypt.

## Deploying

- **Web** (Vercel or similar): set `API_URL` to the API's public URL (e.g. `https://api.example.co.za`). Next.js rewrites `/api/*` to it.
- **API** (Render, Railway, Fly, a VPS, etc.): set `DATABASE_URL`, `WEB_ORIGIN`, `NODE_ENV=production` (makes the session cookie `Secure`), run `npm run db:deploy -w api`, then `npm run build -w api && npm start -w api`.
- Proof-of-payment uploads are written to local disk (`UPLOAD_DIR`). On hosts with ephemeral disks, mount a persistent volume or move the uploads to object storage.

## Project layout

```
apps/api/prisma/schema.prisma        data model
apps/api/prisma/migrations/          SQL migrations (incl. the overlap constraint)
apps/api/src/common/domain.ts        pricing, VAT, balances, SA phone numbers, SAST dates (unit tested)
apps/api/src/bookings/               availability, create/edit/extend/cancel, check-in/out, calendar
apps/api/src/payments/               payments, EFT verification, voids, proof uploads
apps/api/src/reports/                dashboard, reports, cash-up, Excel/PDF export
apps/web/src/app/(app)/              pages: dashboard, bookings, calendar, rooms, guests, payments, reports, settings
apps/web/src/lib/format.ts           R currency, DD/MM/YYYY, SAST helpers, status labels and colours
```
