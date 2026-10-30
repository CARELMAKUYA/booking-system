"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MessageCircle, Phone } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BookingStatusBadge, Detail, ErrorState, LoadingRows, PageHeader, PaymentStatusBadge, RoomStatusBadge } from "@/components/shared";
import { api, qs } from "@/lib/api";
import {
  addDays,
  addMonths,
  BOOKING_STATUS_COLOR,
  BOOKING_STATUS_LABEL,
  diffDays,
  formatDate,
  formatPhone,
  formatRand,
  guestsLabel,
  isValidDate,
  isWeekend,
  monthName,
  nightsLabel,
  startOfMonth,
  startOfWeek,
  todaySast,
  weekday,
  whatsappLink,
} from "@/lib/format";
import type { BookingStatus, CalendarBooking, CalendarData } from "@/lib/types";
import { cn } from "@/lib/utils";

type View = "week" | "month";

function rangeFor(view: View, anchor: string) {
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  // Two weeks either side would be noisy; show exactly the calendar month.
  const from = startOfMonth(anchor);
  return { from, to: addMonths(from, 1) };
}

function CalendarView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const today = todaySast();
  const view: View = params.get("view") === "month" ? "month" : "week";
  const dateParam = params.get("date");
  const anchor = dateParam && isValidDate(dateParam) ? dateParam : today;
  const { from, to } = rangeFor(view, anchor);
  const days = Array.from({ length: diffDays(from, to) }, (_, i) => addDays(from, i));
  const [selected, setSelected] = useState<CalendarBooking | null>(null);
  const [focusDay, setFocusDay] = useState<string>(today);

  const { data, error, isPending } = useQuery({
    queryKey: ["calendar", from, to],
    queryFn: () => api.get<CalendarData>(`/calendar${qs({ from, to })}`),
  });

  const go = (next: { view?: View; date?: string }) => {
    const s = new URLSearchParams(params);
    if (next.view) s.set("view", next.view);
    if (next.date) s.set("date", next.date);
    router.replace(`${pathname}?${s}`);
  };
  const step = (dir: 1 | -1) => go({ date: view === "week" ? addDays(from, 7 * dir) : addMonths(from, dir) });

  const title = view === "week" ? `${formatDate(from)} – ${formatDate(addDays(to, -1))}` : monthName(from);
  const cellWidth = view === "week" ? "minmax(90px, 1fr)" : "minmax(34px, 1fr)";
  const gridTemplateColumns = `minmax(130px, 170px) repeat(${days.length}, ${cellWidth})`;

  const bookingsByRoom = new Map<string, CalendarBooking[]>();
  for (const b of data?.bookings ?? []) bookingsByRoom.set(b.roomId, [...(bookingsByRoom.get(b.roomId) ?? []), b]);
  const freeOn = (day: string) =>
    (data?.rooms ?? []).filter(
      (r) => r.status !== "MAINTENANCE" && !(bookingsByRoom.get(r.id) ?? []).some((b) => b.checkIn <= day && b.checkOut > day),
    );
  const focusInRange = focusDay >= from && focusDay < to;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Click a booking for details, or an empty slot to book that room."
        actions={
          <>
            <div className="flex rounded-lg border p-0.5">
              {(["week", "month"] as const).map((v) => (
                <Button key={v} size="sm" variant={view === v ? "default" : "ghost"} onClick={() => go({ view: v })}>
                  {v === "week" ? "Week" : "Month"}
                </Button>
              ))}
            </div>
            <Button variant="outline" size="icon" aria-label="Previous" onClick={() => step(-1)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" onClick={() => go({ date: today })}>
              Today
            </Button>
            <Button variant="outline" size="icon" aria-label="Next" onClick={() => step(1)}>
              <ChevronRight />
            </Button>
          </>
        }
      />

      <ErrorState error={error} />
      {isPending ? (
        <LoadingRows rows={6} />
      ) : !data ? null : (
        <>
          {focusInRange && (
            <Card className="mb-4">
              <CardContent className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">
                  Free on the night of {weekday(focusDay)} {formatDate(focusDay)}:
                </span>
                {freeOn(focusDay).length === 0 ? (
                  <span className="text-muted-foreground">Fully booked</span>
                ) : (
                  freeOn(focusDay).map((r) => (
                    <Link
                      key={r.id}
                      href={`/bookings/new${qs({ roomId: r.id, checkIn: focusDay, checkOut: addDays(focusDay, 1), source: focusDay === today ? "WALK_IN" : undefined })}`}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      {r.name} · {formatRand(r.pricePerNightCents, { whole: true })}
                    </Link>
                  ))
                )}
                <span className="ml-auto text-xs text-muted-foreground">Click a date heading to check another night</span>
              </CardContent>
            </Card>
          )}

          <Card className="py-0">
            <CardContent className="px-0">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="font-semibold">{title}</h2>
                <Legend />
              </div>
              <div className="overflow-x-auto">
                <div className="min-w-max">
                  {/* Header */}
                  <div className="grid border-b bg-muted/40 text-xs" style={{ gridTemplateColumns }}>
                    <div className="sticky left-0 z-20 border-r bg-muted px-3 py-2 font-medium">Room</div>
                    {days.map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setFocusDay(d)}
                        className={cn(
                          "border-r px-1 py-1.5 text-center hover:bg-muted",
                          isWeekend(d) && "bg-muted/60",
                          d === today && "bg-primary/10 font-semibold text-primary",
                          d === focusDay && "ring-2 ring-inset ring-primary/40",
                        )}
                      >
                        <div>{view === "week" ? weekday(d) : weekday(d).slice(0, 2)}</div>
                        <div className="tabular-nums">{view === "week" ? formatDate(d).slice(0, 5) : Number(d.slice(8))}</div>
                      </button>
                    ))}
                  </div>

                  {/* Rows */}
                  {data.rooms.map((room) => (
                    <div key={room.id} className="grid border-b last:border-b-0" style={{ gridTemplateColumns, gridTemplateRows: "44px" }}>
                      <div className="sticky left-0 z-20 flex flex-col justify-center border-r bg-card px-3" style={{ gridRow: 1, gridColumn: 1 }}>
                        <span className="truncate text-sm font-medium">{room.name}</span>
                        {(room.status === "MAINTENANCE" || room.status === "CLEANING") && (
                          <span className="mt-0.5">
                            <RoomStatusBadge status={room.status} />
                          </span>
                        )}
                      </div>
                      {days.map((d, i) => (
                        <button
                          key={d}
                          type="button"
                          aria-label={`Book ${room.name} on ${formatDate(d)}`}
                          style={{ gridRow: 1, gridColumn: i + 2 }}
                          className={cn(
                            "border-r hover:bg-primary/5",
                            isWeekend(d) && "bg-muted/30",
                            d === today && "bg-primary/5",
                            d < today && "cursor-default hover:bg-transparent",
                          )}
                          onClick={() => {
                            if (d >= today) router.push(`/bookings/new${qs({ roomId: room.id, checkIn: d, checkOut: addDays(d, 1) })}`);
                          }}
                        />
                      ))}
                      {(bookingsByRoom.get(room.id) ?? []).map((b) => {
                        const start = Math.max(0, diffDays(from, b.checkIn));
                        const end = Math.min(days.length, diffDays(from, b.checkOut));
                        const clippedStart = b.checkIn < from;
                        const clippedEnd = b.checkOut > to;
                        return (
                          <button
                            key={b.id}
                            type="button"
                            onClick={() => setSelected(b)}
                            title={`${b.guestName} · ${formatDate(b.checkIn)} – ${formatDate(b.checkOut)} · ${BOOKING_STATUS_LABEL[b.status]}`}
                            style={{ gridRow: 1, gridColumn: `${start + 2} / ${end + 2}` }}
                            className={cn(
                              "z-10 mx-0.5 my-1.5 flex items-center gap-1 overflow-hidden rounded-md border px-1.5 text-left text-xs font-medium shadow-xs transition hover:brightness-95",
                              BOOKING_STATUS_COLOR[b.status],
                              clippedStart && "rounded-l-none border-l-0 ml-0",
                              clippedEnd && "rounded-r-none border-r-0 mr-0",
                            )}
                          >
                            {b.balance.outstandingCents > 0 && b.status !== "CHECKED_OUT" && (
                              <span className="size-1.5 shrink-0 rounded-full bg-rose-500" aria-label="Balance outstanding" />
                            )}
                            <span className="truncate">{b.guestName}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        {selected && (
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{selected.guestName}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{selected.reference}</span>
                <BookingStatusBadge status={selected.status} />
                <PaymentStatusBadge status={selected.balance.paymentStatus} />
              </DialogDescription>
            </DialogHeader>
            <div>
              <Detail label="Room">{data?.rooms.find((r) => r.id === selected.roomId)?.name}</Detail>
              <Detail label="Dates">
                {formatDate(selected.checkIn)} – {formatDate(selected.checkOut)} ({nightsLabel(diffDays(selected.checkIn, selected.checkOut))})
              </Detail>
              <Detail label="Guests">{guestsLabel(selected.adults, selected.children)}</Detail>
              <Detail label="Total">{formatRand(selected.balance.amountDueCents)}</Detail>
              <Detail label="Paid">{formatRand(selected.balance.paidCents)}</Detail>
              <Detail label="Outstanding">{formatRand(selected.balance.outstandingCents)}</Detail>
            </div>
            {selected.guestPhone && (
              <div className="flex gap-2">
                <a href={`tel:${selected.guestPhone}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Phone /> {formatPhone(selected.guestPhone)}
                </a>
                <a href={whatsappLink(selected.guestPhone)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <MessageCircle /> WhatsApp
                </a>
              </div>
            )}
            <DialogFooter>
              <Link href={`/bookings/${selected.id}`} className={buttonVariants()}>
                Open booking
              </Link>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function Legend() {
  const statuses: BookingStatus[] = ["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"];
  return (
    <div className="hidden flex-wrap items-center gap-3 text-xs md:flex">
      {statuses.map((s) => (
        <span key={s} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-sm border", BOOKING_STATUS_COLOR[s])} />
          {BOOKING_STATUS_LABEL[s]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-rose-500" /> Balance owing
      </span>
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<LoadingRows rows={6} />}>
      <CalendarView />
    </Suspense>
  );
}
