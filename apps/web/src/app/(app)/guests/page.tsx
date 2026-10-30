"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, ErrorState, LoadingRows, PageHeader } from "@/components/shared";
import { api, qs } from "@/lib/api";
import { formatDate, formatPhone } from "@/lib/format";
import type { Guest } from "@/lib/types";

export default function GuestsPage() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const { data, error, isPending } = useQuery({
    queryKey: ["guests", debounced],
    queryFn: () => api.get<Guest[]>(`/guests${qs({ q: debounced })}`),
  });

  return (
    <>
      <PageHeader title="Guests" description="Contact details and stay history. Guests are added when you create a booking." />
      <Card>
        <CardContent className="grid gap-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" placeholder="Search by name, phone, email or vehicle registration" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ErrorState error={error} />
          {isPending ? (
            <LoadingRows />
          ) : !data?.length ? (
            <EmptyState>{debounced ? "No matching guests." : "No guests yet."}</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead className="text-right">Stays</TableHead>
                  <TableHead>Last stay</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((g) => (
                  <TableRow key={g.id} className="cursor-pointer" onClick={() => router.push(`/guests/${g.id}`)}>
                    <TableCell>
                      <Link href={`/guests/${g.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                        {g.firstName} {g.lastName}
                      </Link>
                      {(g.stayCount ?? 0) > 1 && <span className="ml-2 text-xs text-emerald-700 dark:text-emerald-400">Returning</span>}
                    </TableCell>
                    <TableCell>
                      {formatPhone(g.phone)}
                      {g.email && <div className="text-xs text-muted-foreground">{g.email}</div>}
                    </TableCell>
                    <TableCell>{g.vehicleReg ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{g.stayCount ?? 0}</TableCell>
                    <TableCell>{formatDate(g.lastStay)}</TableCell>
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
