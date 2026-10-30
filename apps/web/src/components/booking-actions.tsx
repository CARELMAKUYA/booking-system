"use client";

import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, LogIn, LogOut } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DateField, Detail, Field, MoneyInput, NativeSelect, Spinner } from "@/components/shared";
import { api, ApiError } from "@/lib/api";
import { addDays, diffDays, formatDate, formatRand, nightsLabel, todaySast } from "@/lib/format";
import type { Balance, Booking, PaymentMethod, PaymentType } from "@/lib/types";
import { cn } from "@/lib/utils";

type Size = "sm" | "default";

export function CheckInButton({ bookingId, size = "default" }: { bookingId: string; size?: Size }) {
  const m = useMutation({
    mutationFn: () => api.post<Booking>(`/bookings/${bookingId}/check-in`),
    onSuccess: (b) => toast.success(`${b.guest.firstName} ${b.guest.lastName} checked in to ${b.room.name}`),
  });
  return (
    <Button size={size} onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending ? <Spinner /> : <LogIn />} Check in
    </Button>
  );
}

/** Always shows the balance before checking out, as the receptionist must settle it first. */
export function CheckOutButton({ bookingId, guestName, balance, size = "default" }: { bookingId: string; guestName: string; balance: Balance; size?: Size }) {
  const [open, setOpen] = useState(false);
  const owes = balance.outstandingCents > 0;
  const m = useMutation({
    mutationFn: () => api.post<Booking>(`/bookings/${bookingId}/check-out`, { acknowledgeBalance: owes }),
    onSuccess: (b) => {
      toast.success(`${guestName} checked out. ${b.room.name} marked for cleaning.`);
      setOpen(false);
    },
  });
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <LogOut /> Check out
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Check out {guestName}</DialogTitle>
            <DialogDescription>The room will be marked for cleaning.</DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border p-3">
            <Detail label="Amount due">{formatRand(balance.amountDueCents)}</Detail>
            <Detail label="Paid (verified)">{formatRand(balance.paidCents)}</Detail>
            {balance.pendingVerificationCents > 0 && <Detail label="EFT awaiting verification">{formatRand(balance.pendingVerificationCents)}</Detail>}
            <Detail label="Outstanding" className="border-t pt-2 text-base">
              <span className={owes ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}>{formatRand(balance.outstandingCents)}</span>
            </Detail>
          </div>
          {owes && (
            <Alert variant="destructive">
              <AlertTitle>Outstanding balance of {formatRand(balance.outstandingCents)}</AlertTitle>
              <AlertDescription>Record the guest&apos;s payment before they leave, or check out anyway and follow up later.</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            {owes && (
              <Link href={`/bookings/${bookingId}?pay=1`} className={buttonVariants({ variant: "outline" })} onClick={() => setOpen(false)}>
                Record payment
              </Link>
            )}
            <Button onClick={() => m.mutate()} disabled={m.isPending} variant={owes ? "destructive" : "default"}>
              {m.isPending && <Spinner />}
              {owes ? "Check out anyway" : "Check out"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PaymentDialog({ booking, open, onOpenChange }: { booking: Booking; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { balance } = booking;
  const refundMode = balance.paymentStatus === "REFUND_DUE";
  const defaultType: PaymentType = refundMode ? "REFUND" : balance.paidCents === 0 && balance.depositOutstandingCents > 0 ? "DEPOSIT" : "PAYMENT";
  const [type, setType] = useState<PaymentType>(defaultType);
  const [method, setMethod] = useState<PaymentMethod>("EFT");
  const suggested = (t: PaymentType) =>
    t === "REFUND" ? -balance.outstandingCents : t === "DEPOSIT" ? balance.depositOutstandingCents || balance.outstandingCents : balance.outstandingCents;
  const [amount, setAmount] = useState<number | null>(Math.max(0, suggested(defaultType)) || null);
  const [date, setDate] = useState(todaySast());
  const [reference, setReference] = useState(booking.reference);
  const [notes, setNotes] = useState("");
  const [fundsConfirmed, setFundsConfirmed] = useState(false);
  const [file, setFile] = useState<File | null>(null);

  const m = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.set("type", type);
      form.set("method", method);
      form.set("amountCents", String(amount));
      form.set("paymentDate", date);
      if (reference.trim()) form.set("reference", reference.trim());
      if (notes.trim()) form.set("notes", notes.trim());
      if (method === "EFT") form.set("fundsConfirmed", String(fundsConfirmed));
      if (file) form.set("proof", file);
      return api.post(`/bookings/${booking.id}/payments`, form);
    },
    onSuccess: () => {
      toast.success(
        method === "EFT" && !fundsConfirmed && type !== "REFUND"
          ? "EFT recorded. It will count once the funds are verified."
          : `${type === "REFUND" ? "Refund" : "Payment"} of ${formatRand(amount)} recorded`,
      );
      onOpenChange(false);
    },
  });

  const valid = amount !== null && amount > 0 && !!date;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record {type === "REFUND" ? "refund" : "payment"}</DialogTitle>
          <DialogDescription>
            {booking.reference} · Outstanding {formatRand(balance.outstandingCents)}
            {balance.depositOutstandingCents > 0 && ` · Deposit due ${formatRand(balance.depositOutstandingCents)}`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) m.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="pay-type">
              <NativeSelect
                id="pay-type"
                value={type}
                onChange={(e) => {
                  const t = e.target.value as PaymentType;
                  setType(t);
                  setAmount(Math.max(0, suggested(t)) || null);
                }}
              >
                <option value="DEPOSIT">Deposit</option>
                <option value="PAYMENT">Payment</option>
                <option value="REFUND">Refund to guest</option>
              </NativeSelect>
            </Field>
            <Field label="Method" htmlFor="pay-method">
              <NativeSelect id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                <option value="EFT">EFT</option>
                <option value="CASH">Cash</option>
              </NativeSelect>
            </Field>
            <Field label="Amount" htmlFor="pay-amount" required>
              <MoneyInput id="pay-amount" value={amount} onChange={setAmount} />
            </Field>
            <Field label="Payment date" htmlFor="pay-date" required>
              <DateField id="pay-date" value={date} onChange={setDate} max={todaySast()} />
            </Field>
          </div>
          {method === "EFT" && (
            <>
              <Field label="EFT reference" htmlFor="pay-ref" hint="As it appears on the bank statement">
                <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
              </Field>
              {type !== "REFUND" && (
                <label className="flex items-start gap-2 rounded-lg border p-3 text-sm">
                  <Checkbox checked={fundsConfirmed} onCheckedChange={(v) => setFundsConfirmed(v === true)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">Funds have cleared in the bank account</span>
                    <span className="block text-xs text-muted-foreground">
                      Leave unticked if you only have the guest&apos;s proof of payment. It won&apos;t count towards the balance until verified.
                    </span>
                  </span>
                </label>
              )}
              <Field label="Proof of payment (optional)" htmlFor="pay-proof" hint="PDF or image, up to 5 MB">
                <Input id="pay-proof" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </Field>
            </>
          )}
          <Field label="Notes" htmlFor="pay-notes">
            <Textarea id="pay-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || m.isPending}>
              {m.isPending && <Spinner />} Save {type === "REFUND" ? "refund" : "payment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VerifyPaymentButton({ paymentId, amountCents }: { paymentId: string; amountCents: number }) {
  const m = useMutation({
    mutationFn: () => api.post(`/payments/${paymentId}/verify`),
    onSuccess: () => toast.success(`EFT of ${formatRand(amountCents)} verified`),
  });
  return (
    <Button size="xs" variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>
      {m.isPending ? <Spinner /> : <CheckCircle2 />} Verify
    </Button>
  );
}

export function VoidPaymentButton({ paymentId }: { paymentId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/payments/${paymentId}/void`, { reason }),
    onSuccess: () => {
      toast.success("Payment voided");
      setOpen(false);
    },
  });
  return (
    <>
      <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setOpen(true)}>
        Void
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this payment?</DialogTitle>
            <DialogDescription>Use this for entries made in error. The payment stays on record, marked as voided.</DialogDescription>
          </DialogHeader>
          <Field label="Reason" htmlFor="void-reason" required>
            <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Captured twice" />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep payment
            </Button>
            <Button variant="destructive" disabled={reason.trim().length < 3 || m.isPending} onClick={() => m.mutate()}>
              {m.isPending && <Spinner />} Void payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelBookingDialog({ booking, open, onOpenChange }: { booking: Booking; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [fee, setFee] = useState<number | null>(0);
  const m = useMutation({
    mutationFn: () => api.post<Booking>(`/bookings/${booking.id}/cancel`, { reason, cancellationFeeCents: fee ?? 0 }),
    onSuccess: (b) => {
      toast.success(
        b.balance.paymentStatus === "REFUND_DUE" ? `Booking cancelled. Refund due: ${formatRand(-b.balance.outstandingCents)}` : "Booking cancelled",
      );
      onOpenChange(false);
    },
  });
  const refund = booking.balance.paidCents - (fee ?? 0);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel booking {booking.reference}</DialogTitle>
          <DialogDescription>The room becomes available again for these dates.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Reason" htmlFor="cancel-reason">
            <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Guest's plans changed" />
          </Field>
          <Field
            label="Cancellation fee to keep"
            htmlFor="cancel-fee"
            hint={`Guest has paid ${formatRand(booking.balance.paidCents)}. Enter 0 for a full refund.`}
          >
            <MoneyInput id="cancel-fee" value={fee} onChange={setFee} />
          </Field>
          {booking.balance.paidCents > 0 && (
            <p className={cn("text-sm", refund > 0 ? "text-violet-700 dark:text-violet-400" : "text-muted-foreground")}>
              {refund > 0 ? `A refund of ${formatRand(refund)} will be due.` : refund < 0 ? `The guest will still owe ${formatRand(-refund)}.` : "No refund will be due."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep booking
          </Button>
          <Button variant="destructive" onClick={() => m.mutate()} disabled={m.isPending || (fee ?? 0) > booking.totalCents}>
            {m.isPending && <Spinner />} Cancel booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExtendDialog({ booking, open, onOpenChange }: { booking: Booking; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [checkOut, setCheckOut] = useState(addDays(booking.checkOut, 1));
  const m = useMutation({
    mutationFn: () => api.post<Booking>(`/bookings/${booking.id}/extend`, { checkOut }),
    onSuccess: (b) => {
      toast.success(`Stay extended to ${formatDate(b.checkOut)}. New total ${formatRand(b.totalCents)}`);
      onOpenChange(false);
    },
  });
  const nights = checkOut ? diffDays(booking.checkIn, checkOut) : 0;
  const error = m.error instanceof ApiError ? m.error.message : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extend stay</DialogTitle>
          <DialogDescription>
            Currently {formatDate(booking.checkIn)} to {formatDate(booking.checkOut)} ({nightsLabel(booking.nights)})
          </DialogDescription>
        </DialogHeader>
        <Field label="New check-out date" htmlFor="extend-date" error={error}>
          <DateField id="extend-date" value={checkOut} onChange={setCheckOut} min={addDays(booking.checkIn, 1)} />
        </Field>
        {nights > 0 && (
          <p className="text-sm text-muted-foreground">
            {nightsLabel(nights)} at {formatRand(booking.nightlyRateCents)} = <span className="font-medium text-foreground">{formatRand(nights * booking.nightlyRateCents)}</span>
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} disabled={!checkOut || nights < 1 || checkOut === booking.checkOut || m.isPending}>
            {m.isPending && <Spinner />} Update dates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProofLink({ paymentId, name }: { paymentId: string; name: string | null }) {
  return (
    <a href={`/api/payments/${paymentId}/proof`} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
      {name ?? "Proof"}
    </a>
  );
}

