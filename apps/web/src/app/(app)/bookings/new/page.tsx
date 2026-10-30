"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { BookingForm } from "@/components/booking-form";
import { LoadingRows, PageHeader } from "@/components/shared";
import { isValidDate } from "@/lib/format";
import type { BookingSource } from "@/lib/types";

function NewBooking() {
  const params = useSearchParams();
  const date = (key: string) => {
    const v = params.get(key);
    return v && isValidDate(v) ? v : undefined;
  };
  const source = params.get("source");
  return (
    <>
      <PageHeader title="New booking" description="Phone, WhatsApp, email or walk-in" />
      <BookingForm
        initial={{
          roomId: params.get("roomId") ?? undefined,
          checkIn: date("checkIn"),
          checkOut: date("checkOut"),
          guestId: params.get("guestId") ?? undefined,
          source: source && ["PHONE", "WHATSAPP", "EMAIL", "WALK_IN"].includes(source) ? (source as BookingSource) : undefined,
        }}
      />
    </>
  );
}

export default function NewBookingPage() {
  return (
    <Suspense fallback={<LoadingRows />}>
      <NewBooking />
    </Suspense>
  );
}
