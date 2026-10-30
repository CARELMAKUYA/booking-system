"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { BookingForm } from "@/components/booking-form";
import { ErrorState, LoadingRows, PageHeader } from "@/components/shared";
import { api } from "@/lib/api";
import type { Booking } from "@/lib/types";

export default function EditBookingPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isPending } = useQuery({ queryKey: ["booking", id], queryFn: () => api.get<Booking>(`/bookings/${id}`) });
  if (error) return <ErrorState error={error} />;
  if (isPending) return <LoadingRows rows={8} />;
  return (
    <>
      <PageHeader title={`Edit booking ${data.reference}`} description={`${data.guest.firstName} ${data.guest.lastName}`} />
      {/* key: remount with fresh state if the booking changes underneath */}
      <BookingForm key={data.updatedAt} booking={data} />
    </>
  );
}
