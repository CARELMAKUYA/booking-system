"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { User } from "./types";

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: () => api.get<{ user: User }>("/auth/me").then((r) => r.user),
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useIsOwner() {
  return useMe().data?.role === "OWNER";
}
