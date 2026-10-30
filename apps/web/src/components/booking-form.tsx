"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, UserPlus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField, Detail, Field, MoneyInput, NativeSelect, Spinner } from "@/components/shared";
import { api, qs } from "@/lib/api";
import { useIsOwner } from "@/lib/auth";
import { addDays, diffDays, formatDate, formatPhone, formatRand, nightsLabel, todaySast } from "@/lib/format";
import type { AvailabilityRoom, Booking, BookingSource, BookingStatus, Guest, Settings } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Props {
  booking?: Booking;
  initial?: { roomId?: string; checkIn?: string; checkOut?: string; guestId?: string; source?: BookingSource };
}

const emptyGuest = { firstName: "", lastName: "", phone: "", email: "", vehicleReg: "", notes: "", consentGiven: false };

export function BookingForm({ booking, initial }: Props) {
  const router = useRouter();
  const isOwner = useIsOwner();
  const editing = !!booking;
  const locked = booking?.status === "CHECKED_IN"; // arrival date and room are fixed once checked in

  const [checkIn, setCheckIn] = useState(booking?.checkIn ?? initial?.checkIn ?? todaySast());
  const [checkOut, setCheckOut] = useState(booking?.checkOut ?? initial?.checkOut ?? addDays(initial?.checkIn ?? todaySast(), 1));
  const [roomId, setRoomId] = useState(booking?.roomId ?? initial?.roomId ?? "");
  const [adults, setAdults] = useState(booking?.adults ?? 2);
  const [children, setChildren] = useState(booking?.children ?? 0);
  const [source, setSource] = useState<BookingSource>(booking?.source ?? initial?.source ?? "PHONE");
  const [status, setStatus] = useState<BookingStatus>(booking?.status ?? "PENDING");
  const [specialRequests, setSpecialRequests] = useState(booking?.specialRequests ?? "");
  const [internalNotes, setInternalNotes] = useState(booking?.internalNotes ?? "");
  const [rateOverride, setRateOverride] = useState<number | null>(null);
  const [depositOverride, setDepositOverride] = useState<number | null>(null);

  const [guestId, setGuestId] = useState<string | null>(booking?.guestId ?? initial?.guestId ?? null);
  const [pickedGuest, setSelectedGuest] = useState<Guest | null>(booking?.guest ?? null);
  const [newGuest, setNewGuest] = useState(emptyGuest);
  const [guestMode, setGuestMode] = useState<"search" | "new">("search");

  const nights = checkIn && checkOut ? diffDays(checkIn, checkOut) : 0;
  const datesValid = nights >= 1;

  const settings = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  const availability = useQuery({
    queryKey: ["availability", checkIn, checkOut, booking?.id],
    queryFn: () => api.get<AvailabilityRoom[]>(`/bookings/availability${qs({ checkIn, checkOut, excludeBookingId: booking?.id })}`),
    enabled: datesValid,
  });
  const preselectedGuest = useQuery({
    queryKey: ["guest", initial?.guestId],
    queryFn: () => api.get<Guest>(`/guests/${initial!.guestId}`),
    enabled: !!initial?.guestId && !booking,
  });
  // A guest passed in the URL (from the guest page) shows until staff pick someone else.
  const selectedGuest = pickedGuest ?? (guestId && guestId === initial?.guestId ? preselectedGuest.data ?? null : null);

  const rooms = availability.data ?? [];
  const room = rooms.find((r) => r.id === roomId);
  const roomStillFits = room && room.available && adults + children <= room.maxGuests;

  // Keep the original rate when editing the same room; otherwise use the room's current price.
  const baseRate = booking && roomId === booking.roomId ? booking.nightlyRateCents : room?.pricePerNightCents ?? 0;
  const rate = rateOverride ?? baseRate;
  const total = datesValid ? nights * rate : 0;
  const depositPercent = settings.data?.defaultDepositPercent ?? 50;
  const defaultDeposit = Math.round((total * depositPercent) / 100 / 100) * 100;
  const deposit = depositOverride ?? defaultDeposit;
  const vat = settings.data?.vatRegistered ? Math.round((total * settings.data.vatRateBps) / (10000 + settings.data.vatRateBps)) : 0;

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        roomId,
        checkIn,
        checkOut,
        adults,
        children,
        source,
        specialRequests: specialRequests.trim() || undefined,
        internalNotes: internalNotes.trim() || undefined,
        ...(rateOverride !== null && { nightlyRateCents: rateOverride }),
        ...(depositOverride !== null && { depositRequiredCents: depositOverride }),
      };
      if (booking) {
        return api.patch<Booking>(`/bookings/${booking.id}`, {
          ...common,
          ...(locked ? { checkIn: undefined, roomId: undefined } : {}),
          ...(status !== booking.status && { status }),
          specialRequests: specialRequests.trim() || null,
          internalNotes: internalNotes.trim() || null,
        });
      }
      return api.post<Booking>("/bookings", {
        ...common,
        status,
        ...(guestMode === "search" && guestId
          ? { guestId }
          : {
              guest: {
                ...newGuest,
                email: newGuest.email.trim() || undefined,
                vehicleReg: newGuest.vehicleReg.trim() || undefined,
                notes: newGuest.notes.trim() || undefined,
              },
            }),
      });
    },
    meta: { silent: true },
    onSuccess: (b) => {
      toast.success(editing ? "Booking updated" : `Booking ${b.reference} created`);
      router.push(`/bookings/${b.id}`);
    },
  });

  const guestReady = editing || (guestMode === "search" ? !!guestId : newGuest.firstName.trim() && newGuest.lastName.trim() && newGuest.phone.trim());
  const canSave = datesValid && !!roomId && roomStillFits && adults >= 1 && !!guestReady && !save.isPending;

  return (
    <form
      className="grid gap-6 lg:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) save.mutate();
      }}
    >
      <div className="grid gap-6 lg:col-span-2">
        {!editing && (
          <Card>
            <CardHeader>
              <CardTitle>Guest</CardTitle>
            </CardHeader>
            <CardContent>
              {guestMode === "search" ? (
                selectedGuest && guestId ? (
                  <div className="flex items-start justify-between gap-4 rounded-lg border bg-muted/40 p-3">
                    <div>
                      <p className="font-medium">
                        {selectedGuest.firstName} {selectedGuest.lastName}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {formatPhone(selectedGuest.phone)}
                        {selectedGuest.email && ` · ${selectedGuest.email}`}
                      </p>
                      {selectedGuest.stayCount ? (
                        <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
                          Returning guest · {selectedGuest.stayCount} previous stay{selectedGuest.stayCount === 1 ? "" : "s"}
                        </p>
                      ) : null}
                      {selectedGuest.notes && <p className="mt-1 text-xs text-muted-foreground">Note: {selectedGuest.notes}</p>}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Change guest"
                      onClick={() => {
                        setGuestId(null);
                        setSelectedGuest(null);
                      }}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <GuestSearch
                    onSelect={(g) => {
                      setGuestId(g.id);
                      setSelectedGuest(g);
                    }}
                    onNew={(term) => {
                      setGuestMode("new");
                      const looksLikePhone = /^[+\d\s()-]{6,}$/.test(term);
                      const [first, ...rest] = term.trim().split(/\s+/);
                      setNewGuest({
                        ...emptyGuest,
                        ...(looksLikePhone ? { phone: term } : { firstName: first ?? "", lastName: rest.join(" ") }),
                      });
                    }}
                  />
                )
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="First name" htmlFor="g-first" required>
                    <Input id="g-first" value={newGuest.firstName} onChange={(e) => setNewGuest({ ...newGuest, firstName: e.target.value })} autoFocus />
                  </Field>
                  <Field label="Surname" htmlFor="g-last" required>
                    <Input id="g-last" value={newGuest.lastName} onChange={(e) => setNewGuest({ ...newGuest, lastName: e.target.value })} />
                  </Field>
                  <Field label="Contact number" htmlFor="g-phone" required hint="e.g. 082 123 4567 or +27 82 123 4567">
                    <Input id="g-phone" type="tel" value={newGuest.phone} onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })} placeholder="+27" />
                  </Field>
                  <Field label="Email (optional)" htmlFor="g-email">
                    <Input id="g-email" type="email" value={newGuest.email} onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })} />
                  </Field>
                  <Field label="Vehicle registration (optional)" htmlFor="g-vehicle">
                    <Input id="g-vehicle" value={newGuest.vehicleReg} onChange={(e) => setNewGuest({ ...newGuest, vehicleReg: e.target.value })} placeholder="e.g. CA 123-456" />
                  </Field>
                  <Field label="Guest notes" htmlFor="g-notes" hint="Kept on the guest profile for future stays">
                    <Input id="g-notes" value={newGuest.notes} onChange={(e) => setNewGuest({ ...newGuest, notes: e.target.value })} />
                  </Field>
                  <label className="flex items-start gap-2 text-sm sm:col-span-2">
                    <Checkbox checked={newGuest.consentGiven} onCheckedChange={(v) => setNewGuest({ ...newGuest, consentGiven: v === true })} className="mt-0.5" />
                    <span>
                      Guest consents to their details being stored for this booking and future stays (POPIA)
                    </span>
                  </label>
                  <div className="sm:col-span-2">
                    <Button type="button" variant="link" className="px-0" onClick={() => setGuestMode("search")}>
                      <Search /> Search existing guests instead
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Stay</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Check-in" htmlFor="b-in" required>
                <DateField
                  id="b-in"
                  value={checkIn}
                  disabled={locked}
                  onChange={(v) => {
                    setCheckIn(v);
                    if (v && checkOut && v >= checkOut) setCheckOut(addDays(v, Math.max(nights, 1)));
                  }}
                />
              </Field>
              <Field label="Check-out" htmlFor="b-out" required error={checkIn && checkOut && !datesValid ? "Must be after check-in" : null}>
                <DateField id="b-out" value={checkOut} onChange={setCheckOut} min={checkIn ? addDays(checkIn, 1) : undefined} />
              </Field>
              <Field label="Adults" htmlFor="b-adults">
                <Input id="b-adults" type="number" min={1} max={20} value={adults} onChange={(e) => setAdults(Math.max(1, Number(e.target.value) || 1))} />
              </Field>
              <Field label="Children" htmlFor="b-children">
                <Input id="b-children" type="number" min={0} max={20} value={children} onChange={(e) => setChildren(Math.max(0, Number(e.target.value) || 0))} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Booked via" htmlFor="b-source">
                <NativeSelect id="b-source" value={source} onChange={(e) => setSource(e.target.value as BookingSource)}>
                  <option value="PHONE">Phone</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                  <option value="WALK_IN">Walk-in</option>
                </NativeSelect>
              </Field>
              {(!booking || booking.status === "PENDING" || booking.status === "CONFIRMED") && (
                <Field label="Status" htmlFor="b-status" hint="A verified deposit confirms the booking automatically">
                  <NativeSelect id="b-status" value={status} onChange={(e) => setStatus(e.target.value as BookingStatus)}>
                    <option value="PENDING">Pending</option>
                    <option value="CONFIRMED">Confirmed</option>
                  </NativeSelect>
                </Field>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Room</CardTitle>
          </CardHeader>
          <CardContent>
            {locked && <p className="mb-3 text-sm text-muted-foreground">The guest is checked in, so the room can&apos;t be changed here.</p>}
            {!datesValid ? (
              <p className="text-sm text-muted-foreground">Choose valid dates to see which rooms are free.</p>
            ) : availability.isPending ? (
              <Spinner />
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {rooms.map((r) => {
                  const tooSmall = adults + children > r.maxGuests;
                  const disabled = locked ? r.id !== roomId : !r.available || tooSmall;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setRoomId(r.id);
                        setRateOverride(null);
                      }}
                      className={cn(
                        "rounded-lg border p-3 text-left transition-colors",
                        r.id === roomId ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "hover:bg-muted/60",
                        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{r.name}</span>
                        <span className="text-sm tabular-nums">{formatRand(r.pricePerNightCents, { whole: true })}</span>
                      </div>
                      <p className={cn("mt-0.5 text-xs", r.available && !tooSmall ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                        {!r.available ? r.reason : tooSmall ? `Sleeps ${r.maxGuests} max` : `Available · sleeps ${r.maxGuests}`}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
            {room && !roomStillFits && !locked && (
              <p className="mt-3 text-sm text-destructive">The selected room isn&apos;t available for these dates or guests. Pick another room.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notes</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Special requests" htmlFor="b-requests" hint="Visible to all staff, e.g. late arrival, cot, dietary needs">
              <Textarea id="b-requests" value={specialRequests} onChange={(e) => setSpecialRequests(e.target.value)} rows={3} />
            </Field>
            <Field label="Internal notes" htmlFor="b-notes" hint="Staff only">
              <Textarea id="b-notes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} />
            </Field>
          </CardContent>
        </Card>
      </div>

      <div className="lg:sticky lg:top-6 lg:self-start">
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-1">
            <Detail label="Room">{room?.name ?? "—"}</Detail>
            <Detail label="Dates">{datesValid ? `${formatDate(checkIn)} – ${formatDate(checkOut)}` : "—"}</Detail>
            <Detail label="Length">{datesValid ? nightsLabel(nights) : "—"}</Detail>
            {isOwner && room ? (
              <Field label="Nightly rate" htmlFor="b-rate" className="py-1.5" hint={rateOverride !== null ? `Standard rate ${formatRand(baseRate)}` : undefined}>
                <MoneyInput id="b-rate" value={rate} onChange={(v) => setRateOverride(v === baseRate ? null : v)} />
              </Field>
            ) : (
              <Detail label="Nightly rate">{room ? formatRand(rate) : "—"}</Detail>
            )}
            <Detail label="Total" className="border-t pt-3 text-base">
              {formatRand(total)}
            </Detail>
            {vat > 0 && <Detail label="Includes VAT">{formatRand(vat)}</Detail>}
            <Field
              label="Deposit required"
              htmlFor="b-deposit"
              className="pt-2"
              hint={depositOverride === null ? `${depositPercent}% of total` : `Standard ${formatRand(defaultDeposit)}`}
            >
              <MoneyInput id="b-deposit" value={deposit} onChange={(v) => setDepositOverride(v)} />
            </Field>
            {editing && booking.balance.paidCents > 0 && (
              <Detail label="Already paid" className="pt-2">
                {formatRand(booking.balance.paidCents)}
              </Detail>
            )}

            {save.error && (
              <Alert variant="destructive" className="mt-3">
                <AlertDescription>{save.error.message}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" size="lg" className="mt-4" disabled={!canSave}>
              {save.isPending && <Spinner />}
              {editing ? "Save changes" : "Create booking"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

function GuestSearch({ onSelect, onNew }: { onSelect: (g: Guest) => void; onNew: (term: string) => void }) {
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);
  const results = useQuery({
    queryKey: ["guests", "search", debounced],
    queryFn: () => api.get<Guest[]>(`/guests${qs({ q: debounced, take: 8 })}`),
    enabled: debounced.length >= 2,
  });
  const list = useMemo(() => (debounced.length >= 2 ? results.data ?? [] : []), [debounced, results.data]);

  return (
    <div className="grid gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" placeholder="Search returning guests by name, phone or email" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
      </div>
      {list.length > 0 && (
        <div className="grid divide-y rounded-lg border">
          {list.map((g) => (
            <button key={g.id} type="button" className="flex items-center justify-between gap-3 p-2.5 text-left text-sm hover:bg-muted/60" onClick={() => onSelect(g)}>
              <span>
                <span className="font-medium">
                  {g.firstName} {g.lastName}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {formatPhone(g.phone)}
                  {g.email && ` · ${g.email}`}
                </span>
              </span>
              <span className="text-xs text-muted-foreground">
                {g.stayCount ? `${g.stayCount} stay${g.stayCount === 1 ? "" : "s"}${g.lastStay ? ` · last ${formatDate(g.lastStay)}` : ""}` : "No stays yet"}
              </span>
            </button>
          ))}
        </div>
      )}
      {debounced.length >= 2 && results.isSuccess && list.length === 0 && <p className="text-sm text-muted-foreground">No matching guests.</p>}
      <Button type="button" variant="outline" className="justify-self-start" onClick={() => onNew(term)}>
        <UserPlus /> New guest
      </Button>
    </div>
  );
}
