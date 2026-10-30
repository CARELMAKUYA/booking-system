"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Pencil, Phone, Plus, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { BookingStatusBadge, Detail, ErrorState, Field, LoadingRows, PageHeader, PaymentStatusBadge, Spinner, StatCard } from "@/components/shared";
import { api } from "@/lib/api";
import { useIsOwner } from "@/lib/auth";
import { formatDate, formatDateTime, formatPhone, formatRand, nightsLabel, whatsappLink } from "@/lib/format";
import type { Booking, Guest } from "@/lib/types";

type GuestWithBookings = Guest & { bookings: Booking[] };

export default function GuestPage() {
  const { id } = useParams<{ id: string }>();
  const isOwner = useIsOwner();
  const [editOpen, setEditOpen] = useState(false);
  const [anonOpen, setAnonOpen] = useState(false);
  const { data: g, error, isPending } = useQuery({ queryKey: ["guest", id], queryFn: () => api.get<GuestWithBookings>(`/guests/${id}`) });

  const anonymise = useMutation({
    mutationFn: () => api.post(`/guests/${id}/anonymise`),
    onSuccess: () => {
      toast.success("Personal information erased");
      setAnonOpen(false);
    },
  });

  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows rows={6} />;

  const stays = g.bookings.filter((b) => b.status !== "CANCELLED");
  const nights = stays.reduce((s, b) => s + b.nights, 0);
  const spent = g.bookings.reduce((s, b) => s + b.balance.paidCents, 0);

  return (
    <>
      <PageHeader
        title={`${g.firstName} ${g.lastName}`}
        description={g.anonymisedAt ? `Anonymised ${formatDateTime(g.anonymisedAt)}` : `Guest since ${formatDate(g.createdAt.slice(0, 10))}`}
        actions={
          !g.anonymisedAt && (
            <>
              <Link href={`/bookings/new?guestId=${g.id}`} className={buttonVariants()}>
                <Plus /> New booking
              </Link>
              <Button variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil /> Edit
              </Button>
              {isOwner && (
                <Button variant="ghost" className="text-destructive" onClick={() => setAnonOpen(true)}>
                  <ShieldOff /> Erase personal info
                </Button>
              )}
            </>
          )
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2">
            {g.phone && (
              <div className="flex flex-wrap gap-2">
                <a href={`tel:${g.phone}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <Phone /> {formatPhone(g.phone)}
                </a>
                <a href={whatsappLink(g.phone)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                  <MessageCircle /> WhatsApp
                </a>
              </div>
            )}
            <Detail label="Email">{g.email ?? "—"}</Detail>
            <Detail label="Vehicle">{g.vehicleReg ?? "—"}</Detail>
            <Detail label="POPIA consent">{g.consentGiven ? `Yes, ${formatDateTime(g.consentAt)}` : "Not recorded"}</Detail>
            {g.notes && <p className="rounded-lg bg-muted p-2 text-sm">{g.notes}</p>}
          </CardContent>
        </Card>
        <div className="grid grid-cols-3 gap-3 lg:col-span-2 lg:self-start">
          <StatCard label="Stays" value={stays.length} />
          <StatCard label="Nights" value={nights} />
          <StatCard label="Total paid" value={formatRand(spent)} />
        </div>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Booking history</CardTitle>
        </CardHeader>
        <CardContent>
          {g.bookings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No bookings.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Room</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {g.bookings.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <Link href={`/bookings/${b.id}`} className="font-mono text-sm hover:underline">
                        {b.reference}
                      </Link>
                    </TableCell>
                    <TableCell>{b.room.name}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(b.checkIn)} – {formatDate(b.checkOut)}
                      <div className="text-xs text-muted-foreground">{nightsLabel(b.nights)}</div>
                    </TableCell>
                    <TableCell>
                      <BookingStatusBadge status={b.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(b.balance.amountDueCents)}</TableCell>
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

      {editOpen && <EditGuestDialog guest={g} onClose={() => setEditOpen(false)} />}

      <Dialog open={anonOpen} onOpenChange={setAnonOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Erase {g.firstName}&apos;s personal information?</DialogTitle>
            <DialogDescription>
              For a POPIA deletion request. Name, phone, email, vehicle and notes are permanently removed. Booking and payment records are kept for
              financial records, without the guest&apos;s identity. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {anonymise.error && (
            <Alert variant="destructive">
              <AlertDescription>{anonymise.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnonOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => anonymise.mutate()} disabled={anonymise.isPending}>
              {anonymise.isPending && <Spinner />} Erase permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditGuestDialog({ guest, onClose }: { guest: Guest; onClose: () => void }) {
  const [form, setForm] = useState({
    firstName: guest.firstName,
    lastName: guest.lastName,
    phone: formatPhone(guest.phone),
    email: guest.email ?? "",
    vehicleReg: guest.vehicleReg ?? "",
    notes: guest.notes ?? "",
    consentGiven: guest.consentGiven,
  });
  const save = useMutation({
    mutationFn: () =>
      api.patch(`/guests/${guest.id}`, {
        ...form,
        email: form.email.trim() || null,
        vehicleReg: form.vehicleReg.trim() || null,
        notes: form.notes.trim() || null,
        // Only send consent if it changed, so the original consent date is kept.
        consentGiven: form.consentGiven === guest.consentGiven ? undefined : form.consentGiven,
      }),
    onSuccess: () => {
      toast.success("Guest updated");
      onClose();
    },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit guest</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="First name" htmlFor="eg-first" required>
            <Input id="eg-first" value={form.firstName} onChange={set("firstName")} required />
          </Field>
          <Field label="Surname" htmlFor="eg-last" required>
            <Input id="eg-last" value={form.lastName} onChange={set("lastName")} required />
          </Field>
          <Field label="Contact number" htmlFor="eg-phone" required>
            <Input id="eg-phone" type="tel" value={form.phone} onChange={set("phone")} required />
          </Field>
          <Field label="Email" htmlFor="eg-email">
            <Input id="eg-email" type="email" value={form.email} onChange={set("email")} />
          </Field>
          <Field label="Vehicle registration" htmlFor="eg-vehicle">
            <Input id="eg-vehicle" value={form.vehicleReg} onChange={set("vehicleReg")} />
          </Field>
          <Field label="Notes" htmlFor="eg-notes" className="sm:col-span-2">
            <Textarea id="eg-notes" value={form.notes} onChange={set("notes")} rows={2} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <Checkbox checked={form.consentGiven} onCheckedChange={(v) => setForm({ ...form, consentGiven: v === true })} />
            Guest consents to their information being stored (POPIA)
          </label>
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
