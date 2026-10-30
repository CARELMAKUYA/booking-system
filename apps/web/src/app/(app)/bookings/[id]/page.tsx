"use client";

import { useQuery } from "@tanstack/react-query";
import { CalendarPlus, MessageCircle, Pencil, Phone, Plus, XCircle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CancelBookingDialog,
  CheckInButton,
  CheckOutButton,
  ExtendDialog,
  PaymentDialog,
  ProofLink,
  VerifyPaymentButton,
  VoidPaymentButton,
} from "@/components/booking-actions";
import { BookingStatusBadge, Detail, ErrorState, LoadingRows, PageHeader, PaymentStatusBadge } from "@/components/shared";
import { api } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatPhone,
  formatRand,
  guestsLabel,
  METHOD_LABEL,
  nightsLabel,
  SOURCE_LABEL,
  todaySast,
  TYPE_LABEL,
  weekday,
  whatsappLink,
} from "@/lib/format";
import type { Booking } from "@/lib/types";
import { cn } from "@/lib/utils";

function BookingDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const params = useSearchParams();
  // ?pay=1 opens the payment dialog straight away (used from the check-out prompt).
  const [payOpen, setPayOpenState] = useState(() => params.get("pay") === "1");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [extendOpen, setExtendOpen] = useState(false);
  const setPayOpen = (open: boolean) => {
    setPayOpenState(open);
    if (!open && params.get("pay")) router.replace(`/bookings/${id}`);
  };

  const { data: b, error, isPending } = useQuery({ queryKey: ["booking", id], queryFn: () => api.get<Booking>(`/bookings/${id}`) });

  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows rows={8} />;

  const today = todaySast();
  const active = b.status === "PENDING" || b.status === "CONFIRMED";
  const canCheckIn = active && b.checkIn <= today && b.checkOut > today;
  const editable = active || b.status === "CHECKED_IN";
  const guestName = `${b.guest.firstName} ${b.guest.lastName}`;
  const { balance } = b;

  return (
    <>
      <PageHeader
        title={guestName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{b.reference}</span>
            <BookingStatusBadge status={b.status} />
            <PaymentStatusBadge status={balance.paymentStatus} />
          </span>
        }
        actions={
          <>
            {canCheckIn && <CheckInButton bookingId={b.id} />}
            {b.status === "CHECKED_IN" && <CheckOutButton bookingId={b.id} guestName={guestName} balance={balance} />}
            {b.status !== "CHECKED_OUT" || balance.outstandingCents !== 0 ? (
              <Button variant="outline" onClick={() => setPayOpen(true)}>
                <Plus /> {balance.paymentStatus === "REFUND_DUE" ? "Record refund" : "Record payment"}
              </Button>
            ) : null}
            {editable && (
              <>
                <Button variant="outline" onClick={() => setExtendOpen(true)}>
                  <CalendarPlus /> Extend
                </Button>
                <Link href={`/bookings/${b.id}/edit`} className={buttonVariants({ variant: "outline" })}>
                  <Pencil /> Edit
                </Link>
              </>
            )}
            {active && (
              <Button variant="destructive" onClick={() => setCancelOpen(true)}>
                <XCircle /> Cancel
              </Button>
            )}
          </>
        }
      />

      {active && b.checkIn < today && (
        <Alert className="mb-4">
          <AlertTitle>Arrival was due {formatDate(b.checkIn)}</AlertTitle>
          <AlertDescription>Check the guest in, or cancel the booking if they didn&apos;t arrive.</AlertDescription>
        </Alert>
      )}
      {b.status === "CHECKED_IN" && b.checkOut < today && (
        <Alert variant="destructive" className="mb-4">
          <AlertTitle>Departure was due {formatDate(b.checkOut)}</AlertTitle>
          <AlertDescription>Check the guest out, or extend the stay.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="grid gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Stay</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-8 sm:grid-cols-2">
              <div>
                <Detail label="Room">{b.room.name}</Detail>
                <Detail label="Check-in">
                  {weekday(b.checkIn)} {formatDate(b.checkIn)}
                </Detail>
                <Detail label="Check-out">
                  {weekday(b.checkOut)} {formatDate(b.checkOut)}
                </Detail>
                <Detail label="Length">{nightsLabel(b.nights)}</Detail>
                <Detail label="Guests">{guestsLabel(b.adults, b.children)}</Detail>
              </div>
              <div>
                <Detail label="Booked via">{SOURCE_LABEL[b.source]}</Detail>
                <Detail label="Arrived">{formatDateTime(b.actualCheckInAt)}</Detail>
                <Detail label="Departed">{formatDateTime(b.actualCheckOutAt)}</Detail>
                <Detail label="Created">
                  {formatDateTime(b.createdAt)} by {b.createdBy.name}
                </Detail>
                {b.updatedBy && (
                  <Detail label="Last edited">
                    {formatDateTime(b.updatedAt)} by {b.updatedBy.name}
                  </Detail>
                )}
              </div>
              {b.status === "CANCELLED" && (
                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm sm:col-span-2 dark:border-rose-900 dark:bg-rose-950/40">
                  Cancelled {formatDateTime(b.cancelledAt)}
                  {b.cancelReason && ` — ${b.cancelReason}`}. Cancellation fee {formatRand(b.cancellationFeeCents ?? 0)}.
                </div>
              )}
              {(b.specialRequests || b.internalNotes) && (
                <div className="mt-3 grid gap-3 sm:col-span-2 sm:grid-cols-2">
                  {b.specialRequests && (
                    <div className="rounded-lg bg-amber-50 p-3 text-sm dark:bg-amber-950/40">
                      <p className="mb-1 text-xs font-medium uppercase text-amber-800 dark:text-amber-300">Special requests</p>
                      <p className="whitespace-pre-wrap">{b.specialRequests}</p>
                    </div>
                  )}
                  {b.internalNotes && (
                    <div className="rounded-lg bg-muted p-3 text-sm">
                      <p className="mb-1 text-xs font-medium uppercase text-muted-foreground">Internal notes</p>
                      <p className="whitespace-pre-wrap">{b.internalNotes}</p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {b.payments.length === 0 ? (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Reference</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {b.payments.map((p) => (
                      <TableRow key={p.id} className={cn(p.voidedAt && "opacity-50")}>
                        <TableCell className="whitespace-nowrap">
                          {formatDate(p.paymentDate)}
                          <div className="text-xs text-muted-foreground">by {p.recordedBy.name}</div>
                        </TableCell>
                        <TableCell>
                          {TYPE_LABEL[p.type]} · {METHOD_LABEL[p.method]}
                          {p.notes && <div className="text-xs text-muted-foreground">{p.notes}</div>}
                        </TableCell>
                        <TableCell>
                          {p.reference ?? "—"}
                          {p.hasProof && (
                            <div>
                              <ProofLink paymentId={p.id} name={p.proofFileName} />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className={cn("text-right font-medium tabular-nums", p.voidedAt && "line-through")}>
                          {formatRand(p.type === "REFUND" ? -p.amountCents : p.amountCents)}
                        </TableCell>
                        <TableCell>
                          {p.voidedAt ? (
                            <span className="text-xs text-muted-foreground">Voided: {p.voidReason}</span>
                          ) : p.verified ? (
                            <span className="text-xs text-emerald-700 dark:text-emerald-400">
                              Verified{p.method === "EFT" && p.verifiedBy ? ` by ${p.verifiedBy.name}` : ""}
                            </span>
                          ) : (
                            <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Awaiting verification</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {!p.voidedAt && (
                            <div className="flex justify-end gap-1">
                              {!p.verified && <VerifyPaymentButton paymentId={p.id} amountCents={p.amountCents} />}
                              <VoidPaymentButton paymentId={p.id} />
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Balance</CardTitle>
            </CardHeader>
            <CardContent>
              <Detail label={`${nightsLabel(b.nights)} × ${formatRand(b.nightlyRateCents)}`}>{formatRand(b.totalCents)}</Detail>
              {b.vatCents > 0 && <Detail label="Includes VAT">{formatRand(b.vatCents)}</Detail>}
              {b.status === "CANCELLED" && <Detail label="Amount due (cancellation fee)">{formatRand(balance.amountDueCents)}</Detail>}
              <Detail label="Deposit required">{formatRand(b.depositRequiredCents)}</Detail>
              <Detail label="Total received">{formatRand(balance.paidCents)}</Detail>
              {balance.pendingVerificationCents > 0 && (
                <Detail label="EFT awaiting verification">
                  <span className="text-amber-700 dark:text-amber-400">{formatRand(balance.pendingVerificationCents)}</span>
                </Detail>
              )}
              <Detail label={balance.outstandingCents < 0 ? "Refund due" : "Outstanding balance"} className="mt-2 border-t pt-3 text-lg">
                <span
                  className={cn(
                    balance.outstandingCents > 0 && "text-rose-700 dark:text-rose-400",
                    balance.outstandingCents === 0 && "text-emerald-700 dark:text-emerald-400",
                    balance.outstandingCents < 0 && "text-violet-700 dark:text-violet-400",
                  )}
                >
                  {formatRand(Math.abs(balance.outstandingCents))}
                </span>
              </Detail>
              {balance.depositOutstandingCents > 0 && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Deposit still due: {formatRand(balance.depositOutstandingCents)}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guest</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Link href={`/guests/${b.guest.id}`} className="font-medium hover:underline">
                {guestName}
              </Link>
              {b.guest.phone && (
                <div className="flex flex-wrap gap-2">
                  <a href={`tel:${b.guest.phone}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <Phone /> {formatPhone(b.guest.phone)}
                  </a>
                  <a href={whatsappLink(b.guest.phone)} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
                    <MessageCircle /> WhatsApp
                  </a>
                </div>
              )}
              {b.guest.email && (
                <a href={`mailto:${b.guest.email}`} className="text-primary hover:underline">
                  {b.guest.email}
                </a>
              )}
              {b.guest.vehicleReg && <Detail label="Vehicle">{b.guest.vehicleReg}</Detail>}
              {b.guest.notes && <p className="rounded-lg bg-muted p-2 text-xs">{b.guest.notes}</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      {payOpen && <PaymentDialog booking={b} open={payOpen} onOpenChange={setPayOpen} />}
      {cancelOpen && <CancelBookingDialog booking={b} open={cancelOpen} onOpenChange={setCancelOpen} />}
      {extendOpen && <ExtendDialog booking={b} open={extendOpen} onOpenChange={setExtendOpen} />}
    </>
  );
}

export default function BookingPage() {
  return (
    <Suspense fallback={<LoadingRows rows={8} />}>
      <BookingDetail />
    </Suspense>
  );
}
