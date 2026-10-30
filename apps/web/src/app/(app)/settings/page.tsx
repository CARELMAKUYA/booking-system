"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState, Field, LoadingRows, NativeSelect, PageHeader, Spinner } from "@/components/shared";
import { api } from "@/lib/api";
import { useIsOwner, useMe } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import type { AuditEntry, Role, Settings, StaffUser } from "@/lib/types";

export default function SettingsPage() {
  const isOwner = useIsOwner();
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-6">
        <BusinessSettings editable={isOwner} />
        {isOwner && <StaffAccounts />}
        <ChangePassword />
        {isOwner && <AuditLog />}
      </div>
    </>
  );
}

function BusinessSettings({ editable }: { editable: boolean }) {
  const { data, error, isPending } = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows rows={4} />;
  return <BusinessForm initial={data} editable={editable} />;
}

function BusinessForm({ initial, editable }: { initial: Settings; editable: boolean }) {
  const [form, setForm] = useState(initial);

  const save = useMutation({
    mutationFn: (s: Settings) =>
      api.put("/settings", {
        businessName: s.businessName,
        address: s.address || null,
        phone: s.phone || null,
        email: s.email || null,
        vatRegistered: s.vatRegistered,
        vatNumber: s.vatNumber || null,
        vatRateBps: s.vatRateBps,
        defaultDepositPercent: s.defaultDepositPercent,
        checkInTime: s.checkInTime,
        checkOutTime: s.checkOutTime,
        bankDetails: s.bankDetails || null,
      }),
    onSuccess: () => toast.success("Settings saved"),
  });

  const set =<K extends keyof Settings>(k: K, v: Settings[K]) => setForm({ ...form, [k]: v });
  const text = (k: "businessName" | "address" | "phone" | "email" | "vatNumber" | "bankDetails" | "checkInTime" | "checkOutTime") =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value);

  return (
    <Card>
      <CardHeader>
        <CardTitle>BnB details</CardTitle>
        {!editable && <CardDescription>Only the owner can change these.</CardDescription>}
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(form);
          }}
        >
          <fieldset disabled={!editable} className="contents">
            <Field label="Business name" htmlFor="s-name" required>
              <Input id="s-name" value={form.businessName} onChange={text("businessName")} required />
            </Field>
            <Field label="Phone" htmlFor="s-phone">
              <Input id="s-phone" value={form.phone ?? ""} onChange={text("phone")} placeholder="+27" />
            </Field>
            <Field label="Email" htmlFor="s-email">
              <Input id="s-email" type="email" value={form.email ?? ""} onChange={text("email")} />
            </Field>
            <Field label="Address" htmlFor="s-address">
              <Input id="s-address" value={form.address ?? ""} onChange={text("address")} />
            </Field>
            <Field label="Check-in time" htmlFor="s-in">
              <Input id="s-in" type="time" value={form.checkInTime} onChange={text("checkInTime")} />
            </Field>
            <Field label="Check-out time" htmlFor="s-out">
              <Input id="s-out" type="time" value={form.checkOutTime} onChange={text("checkOutTime")} />
            </Field>
            <Field label="Default deposit (%)" htmlFor="s-deposit" hint="Suggested deposit on new bookings">
              <Input
                id="s-deposit"
                type="number"
                min={0}
                max={100}
                value={form.defaultDepositPercent}
                onChange={(e) => set("defaultDepositPercent", Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
              />
            </Field>
            <Field label="Banking details for EFT" htmlFor="s-bank" hint="For sharing with guests">
              <Textarea id="s-bank" value={form.bankDetails ?? ""} onChange={text("bankDetails")} rows={3} />
            </Field>

            <div className="rounded-lg border p-4 sm:col-span-2">
              <label className="flex items-center justify-between gap-4 text-sm">
                <span>
                  <span className="font-medium">VAT registered</span>
                  <span className="block text-xs text-muted-foreground">
                    Room prices are treated as VAT-inclusive. The VAT portion is shown on bookings and reports.
                  </span>
                </span>
                <Switch checked={form.vatRegistered} onCheckedChange={(v) => set("vatRegistered", v)} disabled={!editable} />
              </label>
              {form.vatRegistered && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="VAT number" htmlFor="s-vatno">
                    <Input id="s-vatno" value={form.vatNumber ?? ""} onChange={text("vatNumber")} placeholder="4xxxxxxxxx" />
                  </Field>
                  <Field label="VAT rate (%)" htmlFor="s-vatrate">
                    <Input
                      id="s-vatrate"
                      type="number"
                      step="0.5"
                      min={0}
                      max={50}
                      value={form.vatRateBps / 100}
                      onChange={(e) => set("vatRateBps", Math.round((Number(e.target.value) || 0) * 100))}
                    />
                  </Field>
                </div>
              )}
            </div>
          </fieldset>
          {editable && (
            <div className="sm:col-span-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending && <Spinner />} Save settings
              </Button>
            </div>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function StaffAccounts() {
  const me = useMe();
  const [editing, setEditing] = useState<StaffUser | "new" | null>(null);
  const { data, error, isPending } = useQuery({ queryKey: ["users"], queryFn: () => api.get<StaffUser[]>("/users") });
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Staff accounts</CardTitle>
          <CardDescription>Receptionists can manage bookings and record payments. Owners also see financial reports and manage rooms, prices and staff.</CardDescription>
        </div>
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add staff
        </Button>
      </CardHeader>
      <CardContent>
        <ErrorState error={error} />
        {isPending ? (
          <LoadingRows rows={2} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((u) => (
                <TableRow key={u.id} className={u.active ? "" : "opacity-50"}>
                  <TableCell className="font-medium">
                    {u.name}
                    {u.id === me.data?.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                    {!u.active && <span className="ml-1 text-xs text-muted-foreground">(disabled)</span>}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>{u.role === "OWNER" ? "Owner" : "Receptionist"}</TableCell>
                  <TableCell>{formatDateTime(u.lastLoginAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      {editing && <StaffDialog user={editing === "new" ? null : editing} isSelf={editing !== "new" && editing.id === me.data?.id} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function StaffDialog({ user, isSelf, onClose }: { user: StaffUser | null; isSelf: boolean; onClose: () => void }) {
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [role, setRole] = useState<Role>(user?.role ?? "RECEPTIONIST");
  const [active, setActive] = useState(user?.active ?? true);
  const [password, setPassword] = useState("");
  const save = useMutation({
    mutationFn: () =>
      user
        ? api.patch(`/users/${user.id}`, { name, role, active, ...(password && { password }) })
        : api.post("/users", { name, email, role, password }),
    onSuccess: () => {
      toast.success(user ? "Staff member updated" : "Staff member added");
      onClose();
    },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{user ? `Edit ${user.name}` : "Add staff member"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Full name" htmlFor="u-name" required>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Email (used to sign in)" htmlFor="u-email" required>
            <Input id="u-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={!!user} />
          </Field>
          <Field label="Role" htmlFor="u-role">
            <NativeSelect id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={isSelf}>
              <option value="RECEPTIONIST">Receptionist</option>
              <option value="OWNER">Owner</option>
            </NativeSelect>
          </Field>
          <Field label={user ? "Reset password" : "Temporary password"} htmlFor="u-pass" hint="At least 8 characters. Share it privately and ask them to change it.">
            <Input id="u-pass" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} minLength={8} />
          </Field>
          {user && !isSelf && (
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>
                Account active
                <span className="block text-xs text-muted-foreground">Disabling signs them out immediately.</span>
              </span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || (!user && password.length < 8)}>
              {save.isPending && <Spinner />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const m = useMutation({
    mutationFn: () => api.post("/auth/change-password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success("Password changed. Other devices have been signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
    },
  });
  const mismatch = confirm.length > 0 && next !== confirm;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Change your password</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid max-w-md gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
        >
          <Field label="Current password" htmlFor="p-current">
            <Input id="p-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" htmlFor="p-new" hint="At least 8 characters">
            <Input id="p-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
          </Field>
          <Field label="Confirm new password" htmlFor="p-confirm" error={mismatch ? "Passwords don't match" : null}>
            <Input id="p-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <Button type="submit" className="justify-self-start" disabled={m.isPending || mismatch || next.length < 8}>
            {m.isPending && <Spinner />} Change password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

const ACTION_LABEL: Record<string, string> = {
  LOGIN: "Signed in",
  LOGIN_FAILED: "Failed sign-in",
  LOGOUT: "Signed out",
  CREATE: "Created",
  UPDATE: "Updated",
  CANCEL: "Cancelled",
  CHECK_IN: "Checked in",
  CHECK_OUT: "Checked out",
  VERIFY: "Verified",
  VOID: "Voided",
  VIEW: "Viewed",
  VIEW_PROOF: "Viewed proof of",
  ATTACH_PROOF: "Attached proof to",
  STATUS: "Changed status of",
  EXPORT: "Exported",
  ANONYMISE: "Anonymised",
  PASSWORD_CHANGED: "Changed password",
};

function AuditLog() {
  const { data, error, isPending } = useQuery({ queryKey: ["audit-log"], queryFn: () => api.get<AuditEntry[]>("/users/audit-log") });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity log</CardTitle>
        <CardDescription>The latest 200 actions by staff, including who viewed guest information (POPIA).</CardDescription>
      </CardHeader>
      <CardContent className="max-h-[480px] overflow-y-auto">
        <ErrorState error={error} />
        {isPending ? (
          <LoadingRows />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt)}</TableCell>
                  <TableCell className="text-sm">{a.user?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm">
                    {ACTION_LABEL[a.action] ?? a.action} {a.entity.toLowerCase()}
                  </TableCell>
                  <TableCell className="max-w-md truncate text-xs text-muted-foreground" title={a.details ? JSON.stringify(a.details) : undefined}>
                    {describe(a.details)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function describe(details: unknown) {
  if (!details || typeof details !== "object") return "";
  const d = details as Record<string, unknown>;
  return ["reference", "booking", "name", "email", "reason", "type", "method"]
    .filter((k) => d[k] !== undefined && d[k] !== null)
    .map((k) => String(d[k]))
    .join(" · ");
}
