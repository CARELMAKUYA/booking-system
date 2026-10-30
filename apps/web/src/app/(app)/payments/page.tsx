"use client";

import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProofLink, VerifyPaymentButton } from "@/components/booking-actions";
import {
  BookingStatusBadge,
  DateField,
  EmptyState,
  ErrorState,
  LoadingRows,
  NativeSelect,
  PageHeader,
  PaymentStatusBadge,
  StatCard,
} from "@/components/shared";
import { api, qs } from "@/lib/api";
import { addDays, formatDate, formatPhone, formatRand, formatTime, METHOD_LABEL, todaySast, TYPE_LABEL, weekday } from "@/lib/format";
import type { CashUp, OutstandingRow, Payment } from "@/lib/types";
import { cn } from "@/lib/utils";

type Tab = "outstanding" | "verify" | "recent" | "cashup";

function PaymentsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tab: Tab = params.get("verified") === "false" ? "verify" : ((params.get("tab") as Tab) ?? "outstanding");
  const setTab = (t: Tab) => router.replace(`${pathname}?tab=${t}`);

  return (
    <>
      <PageHeader title="Payments" description="Deposits, balances, EFT verification and the daily cash-up." />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mb-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="outstanding">Outstanding</TabsTrigger>
          <TabsTrigger value="verify">EFT to verify</TabsTrigger>
          <TabsTrigger value="recent">Recent payments</TabsTrigger>
          <TabsTrigger value="cashup">Daily cash-up</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "outstanding" && <Outstanding />}
      {tab === "verify" && <ToVerify />}
      {tab === "recent" && <Recent />}
      {tab === "cashup" && <CashUpView />}
    </>
  );
}

function Outstanding() {
  const [filter, setFilter] = useState<"all" | "deposit" | "balance" | "refund">("all");
  const { data, error, isPending } = useQuery({ queryKey: ["outstanding"], queryFn: () => api.get<OutstandingRow[]>("/reports/outstanding") });
  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows />;
  const rows = data.filter((o) =>
    filter === "deposit"
      ? o.depositOutstandingCents > 0 && o.status !== "CHECKED_OUT"
      : filter === "balance"
        ? o.outstandingCents > 0
        : filter === "refund"
          ? o.paymentStatus === "REFUND_DUE"
          : true,
  );
  const owed = data.filter((o) => o.outstandingCents > 0).reduce((s, o) => s + o.outstandingCents, 0);
  const deposits = data.filter((o) => o.status !== "CHECKED_OUT").reduce((s, o) => s + o.depositOutstandingCents, 0);
  const refunds = data.filter((o) => o.outstandingCents < 0).reduce((s, o) => s - o.outstandingCents, 0);

  return (
    <>
      <div className="mb-4 grid grid-cols-3 gap-3">
        <StatCard label="Balances owed" value={formatRand(owed)} tone={owed ? "bad" : "default"} />
        <StatCard label="Deposits outstanding" value={formatRand(deposits)} tone={deposits ? "warn" : "default"} />
        <StatCard label="Refunds due" value={formatRand(refunds)} />
      </div>
      <Card>
        <CardContent className="grid gap-4">
          <NativeSelect className="sm:w-60" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter">
            <option value="all">Everything outstanding</option>
            <option value="deposit">Deposit not yet paid</option>
            <option value="balance">Balance owing</option>
            <option value="refund">Refund due to guest</option>
          </NativeSelect>
          {rows.length === 0 ? (
            <EmptyState>Nothing outstanding.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Guest</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead>Booking</TableHead>
                  <TableHead className="text-right">Amount due</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Deposit due</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead>Payment</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell>
                      <Link href={`/bookings/${o.id}`} className="font-medium hover:underline">
                        {o.guestName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{formatPhone(o.guestPhone)}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatDate(o.checkIn)} – {formatDate(o.checkOut)}
                      <div className="text-xs text-muted-foreground">{o.roomName}</div>
                    </TableCell>
                    <TableCell>
                      <BookingStatusBadge status={o.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatRand(o.amountDueCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRand(o.paidCents)}
                      {o.pendingVerificationCents > 0 && (
                        <div className="text-xs text-amber-700 dark:text-amber-400">+{formatRand(o.pendingVerificationCents)} unverified</div>
                      )}
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
        </CardContent>
      </Card>
    </>
  );
}

function PaymentTable({ payments, showVerify }: { payments: Payment[]; showVerify?: boolean }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Guest</TableHead>
          <TableHead>Type</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead>Recorded by</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => (
          <TableRow key={p.id}>
            <TableCell className="whitespace-nowrap">{formatDate(p.paymentDate)}</TableCell>
            <TableCell>
              {p.booking && (
                <>
                  <Link href={`/bookings/${p.booking.id}`} className="font-medium hover:underline">
                    {p.booking.guest.firstName} {p.booking.guest.lastName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {p.booking.reference} · {p.booking.room.name}
                  </div>
                </>
              )}
            </TableCell>
            <TableCell>
              {TYPE_LABEL[p.type]} · {METHOD_LABEL[p.method]}
            </TableCell>
            <TableCell>
              {p.reference ?? "—"}
              {p.hasProof && (
                <div>
                  <ProofLink paymentId={p.id} name={p.proofFileName} />
                </div>
              )}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatRand(p.type === "REFUND" ? -p.amountCents : p.amountCents)}</TableCell>
            <TableCell className="text-sm">{p.recordedBy.name}</TableCell>
            <TableCell className="text-right">
              {showVerify && !p.verified ? (
                <VerifyPaymentButton paymentId={p.id} amountCents={p.amountCents} />
              ) : p.verified ? (
                <span className="text-xs text-emerald-700 dark:text-emerald-400">Verified</span>
              ) : (
                <span className="text-xs text-amber-700 dark:text-amber-400">Unverified</span>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ToVerify() {
  const { data, error, isPending } = useQuery({ queryKey: ["payments", "unverified"], queryFn: () => api.get<Payment[]>("/payments?verified=false") });
  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>EFT payments awaiting verification</CardTitle>
        <p className="text-sm text-muted-foreground">
          Check each against the bank statement. Only verify once the funds show in the account; until then they don&apos;t count towards the guest&apos;s balance.
        </p>
      </CardHeader>
      <CardContent>{data.length === 0 ? <EmptyState>All EFT payments are verified.</EmptyState> : <PaymentTable payments={data} showVerify />}</CardContent>
    </Card>
  );
}

function Recent() {
  const [from, setFrom] = useState(addDays(todaySast(), -30));
  const [to, setTo] = useState(todaySast());
  const [method, setMethod] = useState("");
  const { data, error, isPending } = useQuery({
    queryKey: ["payments", from, to, method],
    queryFn: () => api.get<Payment[]>(`/payments${qs({ from, to, method })}`),
  });
  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1 text-sm">
            From
            <DateField value={from} onChange={setFrom} className="w-40" />
          </div>
          <div className="grid gap-1 text-sm">
            To
            <DateField value={to} onChange={setTo} className="w-40" />
          </div>
          <NativeSelect className="w-36" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Method">
            <option value="">Cash & EFT</option>
            <option value="CASH">Cash only</option>
            <option value="EFT">EFT only</option>
          </NativeSelect>
        </div>
        <ErrorState error={error} />
        {isPending ? <LoadingRows /> : data?.length ? <PaymentTable payments={data} showVerify /> : <EmptyState>No payments in this period.</EmptyState>}
      </CardContent>
    </Card>
  );
}

function CashUpView() {
  const [date, setDate] = useState(todaySast());
  const { data, error, isPending } = useQuery({ queryKey: ["cash-up", date], queryFn: () => api.get<CashUp>(`/reports/cash-up?date=${date}`) });

  return (
    <div className="grid gap-4 print:block">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <div className="grid gap-1 text-sm">
          Date
          <DateField value={date} onChange={(v) => v && setDate(v)} max={todaySast()} className="w-40" />
        </div>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer /> Print
        </Button>
      </div>
      <ErrorState error={error} />
      {isPending ? (
        <LoadingRows />
      ) : (
        data && (
          <>
            <h2 className="hidden text-xl font-semibold print:block">
              Cash-up for {weekday(data.date)} {formatDate(data.date)}
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Cash expected in drawer" value={formatRand(data.expectedCashCents)} tone="good" sub={`Received ${formatRand(data.cashReceivedCents)} · refunded ${formatRand(data.cashRefundedCents)}`} />
              <StatCard label="EFT verified" value={formatRand(data.eftVerifiedCents)} />
              <StatCard label="EFT awaiting verification" value={formatRand(data.eftPendingCents)} tone={data.eftPendingCents ? "warn" : "default"} />
              <StatCard label="Total verified" value={formatRand(data.expectedCashCents + data.eftVerifiedCents)} />
            </div>
            {data.byStaff.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>By staff member</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Staff</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Cash</TableHead>
                        <TableHead className="text-right">EFT (verified)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byStaff.map((s) => (
                        <TableRow key={s.name}>
                          <TableCell>{s.name}</TableCell>
                          <TableCell className="text-right">{s.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRand(s.cashCents)}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRand(s.eftCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {data.payments.length === 0 ? (
                  <EmptyState>No payments recorded for this date.</EmptyState>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Time</TableHead>
                        <TableHead>Guest</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>By</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.payments.map((p) => (
                        <TableRow key={p.id} className={cn(p.voidedAt && "opacity-50")}>
                          <TableCell>{formatTime(p.createdAt)}</TableCell>
                          <TableCell>
                            <Link href={`/bookings/${p.bookingId}`} className="hover:underline">
                              {p.guestName}
                            </Link>
                            <div className="text-xs text-muted-foreground">
                              {p.bookingReference} · {p.roomName}
                            </div>
                          </TableCell>
                          <TableCell>
                            {TYPE_LABEL[p.type]} · {METHOD_LABEL[p.method]}
                          </TableCell>
                          <TableCell>{p.reference ?? "—"}</TableCell>
                          <TableCell className={cn("text-right tabular-nums", p.voidedAt && "line-through")}>
                            {formatRand(p.type === "REFUND" ? -p.amountCents : p.amountCents)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {p.voidedAt ? `Voided: ${p.voidReason}` : p.verified ? "Verified" : "Awaiting verification"}
                          </TableCell>
                          <TableCell className="text-sm">{p.recordedBy}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
            <div className="hidden gap-8 pt-12 text-sm print:flex">
              <div className="flex-1 border-t pt-1">Counted by</div>
              <div className="flex-1 border-t pt-1">Checked by</div>
              <div className="flex-1 border-t pt-1">Actual cash counted (R)</div>
            </div>
          </>
        )
      )}
    </div>
  );
}

export default function PaymentsPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <PaymentsView />
    </Suspense>
  );
}
