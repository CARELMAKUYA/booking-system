"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileSpreadsheet, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DateField, EmptyState, ErrorState, LoadingRows, PageHeader, PaymentStatusBadge, StatCard } from "@/components/shared";
import { api, qs } from "@/lib/api";
import { useIsOwner } from "@/lib/auth";
import {
  addDays,
  addMonths,
  endOfMonth,
  formatDate,
  formatRand,
  METHOD_LABEL,
  monthName,
  startOfMonth,
  startOfWeek,
  todaySast,
  TYPE_LABEL,
  weekday,
} from "@/lib/format";
import type { ReportSummary } from "@/lib/types";
import { cn } from "@/lib/utils";

type Period = "day" | "week" | "month" | "custom";

function periodRange(period: Period, anchor: string) {
  if (period === "day") return { from: anchor, to: anchor };
  if (period === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
}

export default function ReportsPage() {
  const isOwner = useIsOwner();
  const [period, setPeriod] = useState<Period>("month");
  const [anchor, setAnchor] = useState(todaySast());
  const [custom, setCustom] = useState({ from: addDays(todaySast(), -30), to: todaySast() });
  const range = period === "custom" ? custom : periodRange(period, anchor);
  const valid = !!range.from && !!range.to && range.from <= range.to;

  const { data, error, isPending } = useQuery({
    queryKey: ["report", range.from, range.to],
    queryFn: () => api.get<ReportSummary>(`/reports/summary${qs(range)}`),
    enabled: isOwner && valid,
  });

  if (!isOwner) {
    return (
      <>
        <PageHeader title="Reports" />
        <EmptyState>
          Financial reports are available to the owner. For today&apos;s cash reconciliation, use the{" "}
          <Link href="/payments?tab=cashup" className="font-medium text-primary underline">
            daily cash-up
          </Link>
          .
        </EmptyState>
      </>
    );
  }

  const step = (dir: 1 | -1) =>
    setAnchor(period === "day" ? addDays(anchor, dir) : period === "week" ? addDays(anchor, 7 * dir) : addMonths(anchor, dir));
  const label =
    period === "day"
      ? `${weekday(range.from)} ${formatDate(range.from)}`
      : period === "month"
        ? monthName(range.from)
        : `${formatDate(range.from)} – ${formatDate(range.to)}`;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Revenue received, occupancy and outstanding payments."
        actions={
          valid && (
            <>
              <a href={`/api/reports/export${qs({ ...range, format: "xlsx" })}`} className={buttonVariants({ variant: "outline" })}>
                <FileSpreadsheet /> Excel
              </a>
              <a href={`/api/reports/export${qs({ ...range, format: "pdf" })}`} className={buttonVariants({ variant: "outline" })}>
                <FileText /> PDF
              </a>
            </>
          )
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border p-0.5">
          {(["day", "week", "month", "custom"] as const).map((p) => (
            <Button key={p} size="sm" variant={period === p ? "default" : "ghost"} onClick={() => setPeriod(p)}>
              {{ day: "Daily", week: "Weekly", month: "Monthly", custom: "Custom" }[p]}
            </Button>
          ))}
        </div>
        {period === "custom" ? (
          <div className="flex items-center gap-2">
            <DateField value={custom.from} onChange={(from) => setCustom({ ...custom, from })} className="w-40" />
            <span className="text-muted-foreground">to</span>
            <DateField value={custom.to} onChange={(to) => setCustom({ ...custom, to })} className="w-40" />
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" aria-label="Previous period" onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
            <span className="min-w-44 text-center text-sm font-medium">{label}</span>
            <Button variant="outline" size="icon" aria-label="Next period" onClick={() => step(1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </div>

      <ErrorState error={error} />
      {!valid ? (
        <EmptyState>Choose a valid date range.</EmptyState>
      ) : isPending ? (
        <LoadingRows rows={8} />
      ) : (
        data && <Report r={data} />
      )}
    </>
  );
}

function Report({ r }: { r: ReportSummary }) {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total received" value={formatRand(r.revenue.totalReceivedCents)} sub={r.business.vatRegistered ? `Incl. VAT ${formatRand(r.revenue.vatCents)}` : "Verified payments, less refunds"} />
        <StatCard label="Cash" value={formatRand(r.revenue.cashCents)} />
        <StatCard label="EFT (verified)" value={formatRand(r.revenue.eftCents)} sub={r.revenue.pendingEftCents ? `${formatRand(r.revenue.pendingEftCents)} awaiting verification` : undefined} />
        <StatCard label="Refunds paid" value={formatRand(r.revenue.refundsCents)} />
        <StatCard label="Occupancy" value={`${r.occupancy.occupancyPercent}%`} sub={`${r.occupancy.roomNightsSold} of ${r.occupancy.roomNightsAvailable} room nights`} />
        <StatCard label="Average nightly rate" value={formatRand(r.occupancy.averageRateCents)} />
        <StatCard label="Bookings made" value={r.bookings.created} />
        <StatCard label="Cancellations" value={r.bookings.cancelled} />
      </div>

      {r.days > 1 && <OccupancyChart r={r} />}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Occupancy by room</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {r.occupancy.rooms.map((room) => (
              <div key={room.roomId} className="grid gap-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{room.name}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {room.occupancyPercent}% · {room.nights} night{room.nights === 1 ? "" : "s"} · {formatRand(room.earnedCents, { whole: true })}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={room.occupancyPercent} aria-valuemin={0} aria-valuemax={100} aria-label={`${room.name} occupancy`}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, room.occupancyPercent)}%` }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding balances (as of today)</CardTitle>
          </CardHeader>
          <CardContent>
            {r.outstanding.length === 0 ? (
              <EmptyState>Nothing outstanding.</EmptyState>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Arrival</TableHead>
                    <TableHead className="text-right">Outstanding</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.outstanding.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell>
                        <Link href={`/bookings/${o.id}`} className="hover:underline">
                          {o.guestName}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(o.checkIn)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatRand(o.outstandingCents)}</TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={o.paymentStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily breakdown</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Rooms occupied</TableHead>
                <TableHead className="text-right">Arrivals</TableHead>
                <TableHead className="text-right">Departures</TableHead>
                <TableHead className="text-right">Cash</TableHead>
                <TableHead className="text-right">EFT</TableHead>
                <TableHead className="text-right">EFT pending</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.daily.map((d) => (
                <TableRow key={d.date}>
                  <TableCell className="whitespace-nowrap">
                    {weekday(d.date)} {formatDate(d.date)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{d.occupiedRooms}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.arrivals}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.departures}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(d.cashCents)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatRand(d.eftCents)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatRand(d.pendingEftCents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payments in this period</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {r.payments.length === 0 ? (
            <EmptyState>No payments.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Guest</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Verified</TableHead>
                  <TableHead>Recorded by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {r.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.paymentDate)}</TableCell>
                    <TableCell>
                      {p.guestName}
                      <div className="text-xs text-muted-foreground">
                        {p.bookingReference} · {p.roomName}
                      </div>
                    </TableCell>
                    <TableCell>
                      {TYPE_LABEL[p.type]} · {METHOD_LABEL[p.method]}
                    </TableCell>
                    <TableCell>{p.reference ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(p.type === "REFUND" ? -p.amountCents : p.amountCents)}</TableCell>
                    <TableCell className={cn("text-xs", !p.verified && "text-amber-700 dark:text-amber-400")}>{p.verified ? "Yes" : "Pending"}</TableCell>
                    <TableCell>{p.recordedBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Single-series bar chart of rooms occupied per night. The daily table below is its table view. */
function OccupancyChart({ r }: { r: ReportSummary }) {
  const max = Math.max(1, r.occupancy.rooms.length);
  const [hover, setHover] = useState<number | null>(null);
  const showEvery = r.days > 16 ? Math.ceil(r.days / 10) : 1;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rooms occupied per night</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative">
          {/* recessive gridlines at 0 and all rooms full; whole rooms only, so no midpoint label */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-40">
            {[1, 0].map((f) => (
              <div key={f} className="absolute inset-x-0 border-t border-dashed border-border" style={{ top: `${(1 - f) * 100}%` }}>
                <span className="absolute -top-2 left-0 bg-card pr-1 text-[10px] text-muted-foreground tabular-nums">{max * f}</span>
              </div>
            ))}
          </div>
          <div className="ml-6 flex h-40 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
            {r.daily.map((d, i) => (
              <div key={d.date} className="relative flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
                <div
                  className={cn("w-full rounded-t-[4px] bg-primary transition-opacity", hover !== null && hover !== i && "opacity-50")}
                  style={{ height: `${(d.occupiedRooms / max) * 100}%`, minHeight: d.occupiedRooms ? 2 : 0 }}
                />
                {hover === i && (
                  <div className="absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
                    <div className="font-medium">
                      {weekday(d.date)} {formatDate(d.date)}
                    </div>
                    <div className="tabular-nums">
                      {d.occupiedRooms} of {max} rooms · {d.arrivals} in · {d.departures} out
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="ml-6 mt-1 flex gap-[2px] text-[10px] text-muted-foreground">
            {r.daily.map((d, i) => (
              <div key={d.date} className="flex-1 text-center tabular-nums">
                {i % showEvery === 0 ? formatDate(d.date).slice(0, 5) : ""}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
