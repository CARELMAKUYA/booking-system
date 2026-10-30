"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BedDouble,
  CalendarDays,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Plus,
  Settings,
  Sun,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Spinner } from "@/components/shared";
import { api } from "@/lib/api";
import { useMe } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/bookings", label: "Bookings", icon: ClipboardList },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/rooms", label: "Rooms", icon: BedDouble },
  { href: "/guests", label: "Guests", icon: Users },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const me = useMe();
  const queryClient = useQueryClient();
  const { resolvedTheme, setTheme } = useTheme();
  // The mobile drawer is open for the page it was opened on, so navigating closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (o: boolean) => setOpenOn(o ? pathname : null);

  const logout = useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      queryClient.clear();
      window.location.href = "/login";
    },
  });

  if (me.isPending || me.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        <Spinner className="size-6" />
      </div>
    );
  }
  const user = me.data;

  const nav = (
    <nav className="grid gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
            isActive(pathname, href)
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
        </Link>
      ))}
    </nav>
  );

  const sidebar = (
    <div className="flex h-full flex-col gap-4 p-3">
      <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <BedDouble className="size-4" />
        </span>
        <span className="font-semibold">BnB Admin</span>
      </Link>
      <Link href="/bookings/new" className={cn(buttonVariants({ size: "lg" }), "w-full")}>
        <Plus /> New booking
      </Link>
      {nav}
      <div className="mt-auto grid gap-2 border-t pt-3">
        <div className="px-2">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="text-xs text-muted-foreground">{user.role === "OWNER" ? "Owner" : "Receptionist"}</p>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 justify-start"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <Sun /> : <Moon />} Theme
          </Button>
          <Button variant="ghost" size="sm" className="flex-1 justify-start" onClick={() => logout.mutate()} disabled={logout.isPending}>
            <LogOut /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/30 print:bg-white">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r bg-sidebar lg:block print:hidden">{sidebar}</aside>

      {/* Mobile header + drawer */}
      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background px-4 lg:hidden print:hidden">
        <Button variant="ghost" size="icon" aria-label="Open menu" onClick={() => setOpen(true)}>
          <Menu />
        </Button>
        <span className="font-semibold">BnB Admin</span>
        <Link href="/bookings/new" className={cn(buttonVariants({ size: "sm" }), "ml-auto")}>
          <Plus /> Booking
        </Link>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-sidebar shadow-xl">
            <Button variant="ghost" size="icon" className="absolute right-2 top-2" aria-label="Close menu" onClick={() => setOpen(false)}>
              <X />
            </Button>
            {sidebar}
          </aside>
        </div>
      )}

      <main className="lg:pl-60 print:pl-0">
        <div className="mx-auto max-w-7xl p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}
