"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Sparkles, Wrench } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState, ErrorState, Field, LoadingRows, MoneyInput, PageHeader, RoomStatusBadge, Spinner } from "@/components/shared";
import { api } from "@/lib/api";
import { useIsOwner } from "@/lib/auth";
import { formatDate, formatRand } from "@/lib/format";
import type { Room, RoomStatus } from "@/lib/types";

export default function RoomsPage() {
  const isOwner = useIsOwner();
  const [editing, setEditing] = useState<Room | "new" | null>(null);
  const { data, error, isPending } = useQuery({
    queryKey: ["rooms", isOwner ? "all" : "active"],
    queryFn: () => api.get<Room[]>(isOwner ? "/rooms/all" : "/rooms"),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RoomStatus }) => api.patch<Room>(`/rooms/${id}/status`, { status }),
    onSuccess: (r) => toast.success(`${r.name} marked ${r.status.toLowerCase()}`),
  });

  return (
    <>
      <PageHeader
        title="Rooms"
        description={isOwner ? "Manage rooms, prices and housekeeping status." : "Update housekeeping status. Only the owner can change rooms and prices."}
        actions={
          isOwner && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Add room
            </Button>
          )
        }
      />
      <ErrorState error={error} />
      {isPending ? (
        <LoadingRows />
      ) : data?.length === 0 ? (
        <EmptyState>No rooms yet. {isOwner && "Add your first room to start taking bookings."}</EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data?.map((room) => (
            <Card key={room.id} className={room.active ? "" : "opacity-60"}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle>{room.name}</CardTitle>
                  {room.active ? <RoomStatusBadge status={room.effectiveStatus} /> : <span className="text-xs text-muted-foreground">Inactive</span>}
                </div>
                <CardDescription>{room.description || "No description"}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Per night</span>
                  <span className="font-semibold tabular-nums">{formatRand(room.pricePerNightCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Sleeps</span>
                  <span>{room.maxGuests}</span>
                </div>
                {room.currentBooking && (
                  <Link href={`/bookings/${room.currentBooking.id}`} className="mt-2 rounded-lg bg-muted p-2 text-xs hover:underline">
                    {room.currentBooking.guestName} · {formatDate(room.currentBooking.checkIn)} – {formatDate(room.currentBooking.checkOut)}
                  </Link>
                )}
              </CardContent>
              <CardFooter className="flex flex-wrap gap-2">
                {room.active && room.status !== "AVAILABLE" && room.effectiveStatus !== "OCCUPIED" && (
                  <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: room.id, status: "AVAILABLE" })}>
                    <Sparkles /> Mark clean / available
                  </Button>
                )}
                {room.active && room.status !== "CLEANING" && room.effectiveStatus !== "OCCUPIED" && (
                  <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: room.id, status: "CLEANING" })}>
                    Needs cleaning
                  </Button>
                )}
                {room.active && room.status !== "MAINTENANCE" && (
                  <Button size="sm" variant="outline" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: room.id, status: "MAINTENANCE" })}>
                    <Wrench /> Maintenance
                  </Button>
                )}
                {isOwner && (
                  <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(room)}>
                    <Pencil /> Edit
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}
      {editing && <RoomDialog room={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function RoomDialog({ room, onClose }: { room: Room | null; onClose: () => void }) {
  const [name, setName] = useState(room?.name ?? "");
  const [description, setDescription] = useState(room?.description ?? "");
  const [price, setPrice] = useState<number | null>(room?.pricePerNightCents ?? null);
  const [maxGuests, setMaxGuests] = useState(room?.maxGuests ?? 2);
  const [sortOrder, setSortOrder] = useState(room?.sortOrder ?? 0);
  const [active, setActive] = useState(room?.active ?? true);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, description: description || undefined, pricePerNightCents: price, maxGuests, sortOrder };
      return room ? api.patch(`/rooms/${room.id}`, { ...body, description: description || null, active }) : api.post("/rooms", body);
    },
    onSuccess: () => {
      toast.success(room ? "Room updated" : "Room added");
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? `Edit ${room.name}` : "Add room"}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Room name or number" htmlFor="room-name" required>
            <Input id="room-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
          </Field>
          <Field label="Description" htmlFor="room-desc">
            <Textarea id="room-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Price per night" htmlFor="room-price" required className="col-span-3 sm:col-span-1">
              <MoneyInput id="room-price" value={price} onChange={setPrice} />
            </Field>
            <Field label="Sleeps" htmlFor="room-guests">
              <Input id="room-guests" type="number" min={1} max={20} value={maxGuests} onChange={(e) => setMaxGuests(Number(e.target.value) || 1)} />
            </Field>
            <Field label="Display order" htmlFor="room-order">
              <Input id="room-order" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value) || 0)} />
            </Field>
          </div>
          {room && (
            <label className="flex items-center justify-between gap-2 text-sm">
              <span>
                Active
                <span className="block text-xs text-muted-foreground">Inactive rooms are hidden from new bookings and the calendar.</span>
              </span>
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          {room && price !== null && price !== room.pricePerNightCents && (
            <p className="text-xs text-muted-foreground">The new price applies to new bookings. Existing bookings keep their agreed rate.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || price === null || save.isPending}>
              {save.isPending && <Spinner />} Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
