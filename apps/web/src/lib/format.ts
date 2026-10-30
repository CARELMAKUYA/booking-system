import type { BookingSource, BookingStatus, PaymentMethod, PaymentStatus, PaymentType, RoomStatus } from "./types";

export const TIME_ZONE = "Africa/Johannesburg";

/** R 1 234.50 */
export function formatRand(cents: number | null | undefined, opts: { whole?: boolean } = {}) {
  if (cents === null || cents === undefined) return "—";
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents) / 100;
  const [whole, frac] = value.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return opts.whole && frac === "00" ? `${sign}R ${grouped}` : `${sign}R ${grouped}.${frac}`;
}

/** Parses "1 234.50", "1234,50" or "R1234" into cents. Returns null if invalid. */
export function parseRand(input: string): number | null {
  const cleaned = input.replace(/[Rr\s]/g, "").replace(",", ".");
  if (!cleaned) return null;
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2).replace(/\.00$/, "");
}

/** YYYY-MM-DD → DD/MM/YYYY */
export function formatDate(date: string | null | undefined) {
  if (!date) return "—";
  const [y, m, d] = date.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** DD/MM/YYYY → YYYY-MM-DD, or null if invalid. */
export function parseDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null;
}

/** True for a real `YYYY-MM-DD` calendar date. */
export function isValidDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && parseDate(formatDate(value)) === value;
}

/** ISO timestamp → "30/10/2026 14:05" in SAST */
export function formatDateTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
}

export function formatTime(iso: string) {
  return formatDateTime(iso).slice(11);
}

export function todaySast() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffDays(from: string, to: string) {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);
}

export function startOfWeek(date: string) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function startOfMonth(date: string) {
  return `${date.slice(0, 7)}-01`;
}

export function addMonths(date: string, months: number) {
  const d = new Date(`${startOfMonth(date)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export function endOfMonth(date: string) {
  return addDays(addMonths(date, 1), -1);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function weekday(date: string) {
  return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

export function monthName(date: string) {
  return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
}

export function isWeekend(date: string) {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
}

/** +27821234567 → +27 82 123 4567 */
export function formatPhone(phone: string | null | undefined) {
  if (!phone) return "—";
  const m = phone.match(/^\+27(\d{2})(\d{3})(\d{4})$/);
  return m ? `+27 ${m[1]} ${m[2]} ${m[3]}` : phone;
}

/** wa.me link for WhatsApp, which SA guests use heavily. */
export function whatsappLink(phone: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

export function nightsLabel(n: number) {
  return `${n} night${n === 1 ? "" : "s"}`;
}

export function guestsLabel(adults: number, children: number) {
  return `${adults} adult${adults === 1 ? "" : "s"}${children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}`;
}

export const BOOKING_STATUS_LABEL: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Partially paid",
  FULLY_PAID: "Fully paid",
  REFUND_DUE: "Refund due",
};

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  AVAILABLE: "Available",
  BOOKED: "Booked",
  OCCUPIED: "Occupied",
  CLEANING: "Cleaning",
  MAINTENANCE: "Maintenance",
};

export const SOURCE_LABEL: Record<BookingSource, string> = {
  PHONE: "Phone",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  WALK_IN: "Walk-in",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = { CASH: "Cash", EFT: "EFT" };
export const TYPE_LABEL: Record<PaymentType, string> = { DEPOSIT: "Deposit", PAYMENT: "Payment", REFUND: "Refund" };

/** Tailwind classes per status. Used for badges and calendar bars so colours match everywhere. */
export const BOOKING_STATUS_COLOR: Record<BookingStatus, string> = {
  PENDING: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  CONFIRMED: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  CHECKED_IN: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  CHECKED_OUT: "bg-zinc-100 text-zinc-700 border-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700",
  CANCELLED: "bg-rose-50 text-rose-800 border-rose-200 line-through dark:bg-rose-950 dark:text-rose-300 dark:border-rose-900",
};

export const PAYMENT_STATUS_COLOR: Record<PaymentStatus, string> = {
  UNPAID: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
  PARTIALLY_PAID: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  FULLY_PAID: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  REFUND_DUE: "bg-violet-100 text-violet-900 border-violet-300 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800",
};

export const ROOM_STATUS_COLOR: Record<RoomStatus, string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800",
  BOOKED: "bg-sky-100 text-sky-900 border-sky-300 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800",
  OCCUPIED: "bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800",
  CLEANING: "bg-amber-100 text-amber-900 border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800",
  MAINTENANCE: "bg-rose-100 text-rose-900 border-rose-300 dark:bg-rose-950 dark:text-rose-200 dark:border-rose-800",
};
