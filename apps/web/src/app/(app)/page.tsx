"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, BedDouble, CalendarCheck, CalendarX, Banknote, Wallet } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BookingStatusBadge,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageHeader,
  PaymentStatusBadge,
  RoomStatusBadge,
  StatCard,
} from "@/components/shared";
import { CheckInButton, CheckOutButton } from "@/components/booking-actions";
import { api } from "@/lib/api";
import { formatDate, formatRand, guestsLabel, todaySast, weekday } from "@/lib/format";
import type { BookingSummaryRow, Dashboard } from "@/lib/types";

export default function DashboardPage() {
  const { data, error, isPending } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api.get<Dashboard>("/dashboard"),
    refetchInterval: 60_000,
  });

  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows rows={8} />;
  const d = data;

  return (
    <>
      <PageHeader title="Dashboard" description={`${weekday(d.today)} ${formatDate(d.today)}`} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Rooms" value={d.rooms.total} icon={BedDouble} sub={`${d.inHouse} guest booking${d.inHouse === 1 ? "" : "s"} in house`} />
        <StatCard label="Available now" value={d.rooms.available} tone="good" sub={`${d.rooms.cleaning} cleaning · ${d.rooms.maintenance} maintenance`} />
        <StatCard label="Occupied" value={d.rooms.occupied} sub={`${d.rooms.booked} more arriving today`} />
        <StatCard label="Check-ins today" value={d.arrivals.length} icon={CalendarCheck} />
        <StatCard label="Check-outs today" value={d.departures.length} icon={CalendarX} />
        <StatCard label="Bookings made" value={d.bookings.today} sub={`${d.bookings.thisMonth} this month`} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Received today" value={formatRand(d.payments.todayCents)} icon={Banknote} tone="good" />
        <StatCard
          label="Received this month"
          value={d.payments.monthCents === null ? "Owner only" : formatRand(d.payments.monthCents)}
          icon={Wallet}
        />
        <StatCard
          label="Deposits outstanding"
          value={formatRand(d.outstanding.depositsCents)}
          tone={d.outstanding.depositsCount ? "warn" : "default"}
          sub={`${d.outstanding.depositsCount} booking${d.outstanding.depositsCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Balances outstanding"
          value={formatRand(d.outstanding.balancesCents)}
          tone={d.outstanding.balancesCount ? "bad" : "default"}
          sub={
            <>
              {d.outstanding.balancesCount} booking{d.outstanding.balancesCount === 1 ? "" : "s"}
              {d.outstanding.pendingEftCount > 0 && (
                <Link href="/payments?verified=false" className="ml-1 font-medium text-amber-700 underline dark:text-amber-400">
                  · {d.outstanding.pendingEftCount} EFT to verify
                </Link>
              )}
            </>
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <MovementCard title="Today's check-ins" rows={d.arrivals} empty="No arrivals today." kind="arrival" />
        <MovementCard title="Today's check-outs" rows={d.departures} empty="No departures today." kind="departure" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Upcoming bookings (next 7 days)</CardTitle>
          </CardHeader>
          <CardContent>
            {d.upcoming.length === 0 ? (
              <EmptyState>No upcoming arrivals this week.</EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Arrival</TableHead>
                    <TableHead>Guest</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.upcoming.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap">
                        {weekday(b.checkIn)} {formatDate(b.checkIn)}
                      </TableCell>
                      <TableCell>
                        <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
                          {b.guestName}
                        </Link>
                      </TableCell>
                      <TableCell>{b.roomName}</TableCell>
                      <TableCell>
                        <BookingStatusBadge status={b.status} />
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={b.balance.paymentStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Room status</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {d.rooms.list.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{r.name}</p>
                  {r.currentBooking && <p className="truncate text-xs text-muted-foreground">{r.currentBooking.guestName}</p>}
                </div>
                <RoomStatusBadge status={r.effectiveStatus} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-600" /> Outstanding payments
          </CardTitle>
        </CardHeader>
        <CardContent>
          {d.outstanding.list.length === 0 ? (
            <EmptyState>All bookings are paid up.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Deposit due</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.outstanding.list.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/bookings/${o.id}`} className="font-medium hover:underline">
                        {o.guestName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {o.reference} · {o.roomName}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(o.checkIn)} – {formatDate(o.checkOut)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(o.depositOutstandingCents)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatRand(o.outstandingCents)}</TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {d.outstanding.list.length > 0 && (
            <Link href="/payments" className="mt-3 inline-block text-sm font-medium text-primary hover:underline">
              View all outstanding →
            </Link>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function MovementCard({ title, rows, empty, kind }: { title: string; rows: BookingSummaryRow[]; empty: string; kind: "arrival" | "departure" }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <EmptyState>{empty}</EmptyState>
        ) : (
          <div className="grid gap-2">
            {rows.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/bookings/${b.id}`} className="font-medium hover:underline">
                    {b.guestName}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {b.roomName} · {guestsLabel(b.adults, b.children)}
                    {kind === "departure" && b.checkOut < todaySast() && b.status === "CHECKED_IN" && (
                      <span className="ml-1 font-medium text-rose-600">· overdue since {formatDate(b.checkOut)}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {b.balance.outstandingCents > 0 && (
                    <span className="text-xs font-medium text-rose-700 dark:text-rose-400">Owes {formatRand(b.balance.outstandingCents)}</span>
                  )}
                  <BookingStatusBadge status={b.status} />
                  {kind === "arrival" && (b.status === "PENDING" || b.status === "CONFIRMED") && <CheckInButton bookingId={b.id} size="sm" />}
                  {kind === "departure" && b.status === "CHECKED_IN" && (
                    <CheckOutButton bookingId={b.id} guestName={b.guestName} balance={b.balance} size="sm" />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

