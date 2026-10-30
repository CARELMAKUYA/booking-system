"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookingStatusBadge, EmptyState, ErrorState, LoadingRows, NativeSelect, PageHeader, PaymentStatusBadge } from "@/components/shared";
import { api, qs } from "@/lib/api";
import { addDays, formatDate, formatPhone, formatRand, guestsLabel, nightsLabel, SOURCE_LABEL, todaySast } from "@/lib/format";
import type { Booking } from "@/lib/types";

const VIEWS: Record<string, { label: string; params: () => Record<string, string> }> = {
  upcoming: { label: "Current & upcoming", params: () => ({ status: "PENDING,CONFIRMED,CHECKED_IN", from: todaySast() }) },
  arrivals: { label: "Arriving today", params: () => ({ status: "PENDING,CONFIRMED,CHECKED_IN", from: todaySast(), to: todaySast(), arrivingOnly: "1" }) },
  inhouse: { label: "Checked in", params: () => ({ status: "CHECKED_IN" }) },
  pending: { label: "Pending", params: () => ({ status: "PENDING" }) },
  past: { label: "Past 30 days", params: () => ({ status: "CHECKED_OUT", from: addDays(todaySast(), -30) }) },
  cancelled: { label: "Cancelled", params: () => ({ status: "CANCELLED" }) },
  all: { label: "All bookings", params: () => ({}) },
};

function BookingsList() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") ?? "upcoming";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [paymentStatus, setPaymentStatus] = useState(params.get("payment") ?? "");

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params);
      if (q) next.set("q", q);
      else next.delete("q");
      if (paymentStatus) next.set("payment", paymentStatus);
      else next.delete("payment");
      if (next.toString() !== params.toString()) router.replace(`${pathname}?${next}`);
    }, 300);
    return () => clearTimeout(t);
  }, [q, paymentStatus, params, pathname, router]);

  const { arrivingOnly, ...viewParams } = (VIEWS[view] ?? VIEWS.upcoming).params();
  const query = { ...viewParams, q: params.get("q") ?? undefined, paymentStatus: params.get("payment") ?? undefined };
  const { data, error, isPending } = useQuery({
    queryKey: ["bookings", query],
    queryFn: () => api.get<Booking[]>(`/bookings${qs(query)}`),
  });
  const rows = arrivingOnly ? data?.filter((b) => b.checkIn === todaySast()) : data;

  return (
    <>
      <PageHeader
        title="Bookings"
        actions={
          <Link href="/bookings/new" className={buttonVariants()}>
            <Plus /> New booking
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Object.entries(VIEWS).map(([key, v]) => (
          <Link
            key={key}
            href={`/bookings?view=${key}`}
            className={buttonVariants({ variant: key === view ? "default" : "outline", size: "sm" })}
          >
            {v.label}
          </Link>
        ))}
      </div>
      <Card>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search by guest, phone, reference or room" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <NativeSelect className="sm:w-48" value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} aria-label="Payment status">
              <option value="">Any payment status</option>
              <option value="UNPAID">Unpaid</option>
              <option value="PARTIALLY_PAID">Partially paid</option>
              <option value="FULLY_PAID">Fully paid</option>
              <option value="REFUND_DUE">Refund due</option>
            </NativeSelect>
          </div>
          <ErrorState error={error} />
          {isPending ? (
            <LoadingRows />
          ) : !rows?.length ? (
            <EmptyState>No bookings found.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((b) => (
                  <TableRow key={b.id} className="cursor-pointer" onClick={() => router.push(`/bookings/${b.id}`)}>
                    <TableCell>
                      <Link href={`/bookings/${b.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {b.guest.firstName} {b.guest.lastName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {b.reference} · {formatPhone(b.guest.phone)} · {SOURCE_LABEL[b.source]}
                      </div>
                    </TableCell>
                    <TableCell>
                      {b.room.name}
                      <div className="text-xs text-muted-foreground">{guestsLabel(b.adults, b.children)}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(b.checkIn)} – {formatDate(b.checkOut)}
                      <div className="text-xs text-muted-foreground">{nightsLabel(b.nights)}</div>
                    </TableCell>
                    <TableCell>
                      <BookingStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(b.balance.amountDueCents)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{formatRand(b.balance.outstandingCents)}</TableCell>
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
    </>
  );
}

export default function BookingsPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <BookingsList />
    </Suspense>
  );
}
