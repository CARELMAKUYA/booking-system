// Shapes returned by the API. Dates are `YYYY-MM-DD`; money is integer cents (ZAR).

export type Role = "OWNER" | "RECEPTIONIST";
export type RoomStatus = "AVAILABLE" | "BOOKED" | "OCCUPIED" | "CLEANING" | "MAINTENANCE";
export type BookingStatus = "PENDING" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED";
export type BookingSource = "PHONE" | "WHATSAPP" | "EMAIL" | "WALK_IN";
export type PaymentMethod = "CASH" | "EFT";
export type PaymentType = "DEPOSIT" | "PAYMENT" | "REFUND";
export type PaymentStatus = "UNPAID" | "PARTIALLY_PAID" | "FULLY_PAID" | "REFUND_DUE";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export interface StaffUser extends User {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Settings {
  businessName: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  vatRateBps: number;
  defaultDepositPercent: number;
  checkInTime: string;
  checkOutTime: string;
  bankDetails: string | null;
}

export interface Room {
  id: string;
  name: string;
  description: string | null;
  pricePerNightCents: number;
  maxGuests: number;
  status: RoomStatus;
  effectiveStatus: RoomStatus;
  active: boolean;
  sortOrder: number;
  currentBooking: {
    id: string;
    reference: string;
    status: BookingStatus;
    checkIn: string;
    checkOut: string;
    guestName: string;
  } | null;
}

export interface Guest {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | null;
  vehicleReg: string | null;
  notes: string | null;
  consentGiven: boolean;
  consentAt: string | null;
  anonymisedAt: string | null;
  createdAt: string;
  stayCount?: number;
  lastStay?: string | null;
}

export interface Balance {
  amountDueCents: number;
  paidCents: number;
  pendingVerificationCents: number;
  outstandingCents: number;
  depositOutstandingCents: number;
  paymentStatus: PaymentStatus;
}

export interface Payment {
  id: string;
  bookingId: string;
  type: PaymentType;
  method: PaymentMethod;
  amountCents: number;
  paymentDate: string;
  reference: string | null;
  notes: string | null;
  proofFileName: string | null;
  hasProof: boolean;
  verified: boolean;
  verifiedAt: string | null;
  verifiedBy: { id: string; name: string } | null;
  recordedBy: { id: string; name: string };
  voidedAt: string | null;
  voidReason: string | null;
  createdAt: string;
  booking?: { id: string; reference: string; guest: { firstName: string; lastName: string }; room: { name: string } };
}

export interface Booking {
  id: string;
  reference: string;
  guestId: string;
  guest: Guest;
  roomId: string;
  room: { id: string; name: string; pricePerNightCents: number; maxGuests: number };
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  status: BookingStatus;
  source: BookingSource;
  nightlyRateCents: number;
  nights: number;
  totalCents: number;
  vatCents: number;
  depositRequiredCents: number;
  cancellationFeeCents: number | null;
  specialRequests: string | null;
  internalNotes: string | null;
  actualCheckInAt: string | null;
  actualCheckOutAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdBy: { id: string; name: string };
  updatedBy: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  payments: Payment[];
  balance: Balance;
}

export interface BookingSummaryRow {
  id: string;
  reference: string;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestPhone: string;
  roomName: string;
  adults: number;
  children: number;
  balance: Balance;
}

export interface OutstandingRow extends Balance {
  id: string;
  reference: string;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  guestName: string;
  guestPhone: string;
  roomName: string;
  totalCents: number;
  depositRequiredCents: number;
}

export interface Dashboard {
  today: string;
  rooms: { total: number; available: number; booked: number; occupied: number; cleaning: number; maintenance: number; list: Room[] };
  inHouse: number;
  arrivals: BookingSummaryRow[];
  departures: BookingSummaryRow[];
  upcoming: BookingSummaryRow[];
  outstanding: {
    depositsCount: number;
    depositsCents: number;
    balancesCount: number;
    balancesCents: number;
    refundsDueCount: number;
    pendingEftCount: number;
    list: OutstandingRow[];
  };
  bookings: { today: number; thisMonth: number };
  payments: { todayCents: number; monthCents: number | null };
}

export interface AvailabilityRoom {
  id: string;
  name: string;
  pricePerNightCents: number;
  maxGuests: number;
  status: RoomStatus;
  available: boolean;
  reason: string | null;
}

export interface CalendarBooking {
  id: string;
  reference: string;
  roomId: string;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  adults: number;
  children: number;
  guestName: string;
  guestPhone: string;
  totalCents: number;
  balance: Balance;
}

export interface CalendarData {
  from: string;
  to: string;
  today: string;
  rooms: { id: string; name: string; status: RoomStatus; pricePerNightCents: number; maxGuests: number }[];
  bookings: CalendarBooking[];
}

export interface ReportPaymentRow {
  id: string;
  paymentDate: string;
  bookingReference: string;
  guestName: string;
  roomName: string;
  type: PaymentType;
  method: PaymentMethod;
  amountCents: number;
  reference: string | null;
  verified: boolean;
  recordedBy: string;
}

export interface ReportSummary {
  from: string;
  to: string;
  days: number;
  business: { name: string; vatRegistered: boolean; vatNumber: string | null };
  revenue: {
    totalReceivedCents: number;
    cashCents: number;
    eftCents: number;
    depositsCents: number;
    refundsCents: number;
    pendingEftCents: number;
    vatCents: number;
  };
  bookings: { created: number; cancelled: number };
  occupancy: {
    roomNightsSold: number;
    roomNightsAvailable: number;
    occupancyPercent: number;
    averageRateCents: number;
    rooms: { roomId: string; name: string; nights: number; earnedCents: number; occupancyPercent: number }[];
  };
  daily: { date: string; occupiedRooms: number; arrivals: number; departures: number; cashCents: number; eftCents: number; pendingEftCents: number }[];
  payments: ReportPaymentRow[];
  outstanding: OutstandingRow[];
}

export interface CashUp {
  date: string;
  isToday: boolean;
  cashReceivedCents: number;
  cashRefundedCents: number;
  expectedCashCents: number;
  eftVerifiedCents: number;
  eftPendingCents: number;
  byStaff: { name: string; cashCents: number; eftCents: number; count: number }[];
  payments: {
    id: string;
    createdAt: string;
    bookingId: string;
    bookingReference: string;
    guestName: string;
    roomName: string;
    type: PaymentType;
    method: PaymentMethod;
    amountCents: number;
    reference: string | null;
    verified: boolean;
    voidedAt: string | null;
    voidReason: string | null;
    recordedBy: string;
  }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  details: unknown;
  createdAt: string;
  user: { name: string } | null;
}
