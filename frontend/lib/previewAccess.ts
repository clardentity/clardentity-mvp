"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/apiClient";
import type { PickableMode } from "@/lib/modes";

/* Which companions this account can start.
 *
 * Four of the eight belong to paid tiers that cannot be bought yet, so the
 * picker locks them. "Skip for now" in the plans dialog opens them for this
 * account against a daily message allowance (the server owns both the grant
 * and the count - see services/preview_access.py). This store holds the
 * answer so the picker, the dialog and the smart-switch path all agree
 * without each fetching it.
 */

export type PreviewAccess = {
  unlocked: boolean;
  modes: PickableMode[];
  dailyLimit: number;
  usedToday: number;
  remainingToday: number;
};

type Wire = {
  unlocked: boolean;
  modes: string[];
  daily_limit: number;
  used_today: number;
  remaining_today: number;
};

/** Until the server answers, assume locked: showing a mode as open and then
 *  taking it away reads as a bug, the other way round reads as loading. */
const LOCKED: PreviewAccess = {
  unlocked: false,
  modes: ["mentoring", "therapy", "creative", "legal"],
  dailyLimit: 0,
  usedToday: 0,
  remainingToday: 0,
};

let snapshot: PreviewAccess = LOCKED;
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function fromWire(wire: Wire): PreviewAccess {
  return {
    unlocked: wire.unlocked,
    modes: wire.modes as PickableMode[],
    dailyLimit: wire.daily_limit,
    usedToday: wire.used_today,
    remainingToday: wire.remaining_today,
  };
}

function put(wire: Wire) {
  snapshot = fromWire(wire);
  loaded = true;
  emit();
}

/** Fetch once per page load; later calls reuse the answer. */
export function loadPreviewAccess(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  if (inFlight) return inFlight;
  inFlight = apiFetch<Wire>("/pro/preview")
    .then(put)
    .catch(() => {
      // Not signed in, or the endpoint is unavailable: the locks stay on,
      // which is the safe reading and what the picker already shows.
      loaded = true;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** "Skip for now" - open the locked companions for this account. */
export async function openPreviewAccess(): Promise<PreviewAccess> {
  put(await apiFetch<Wire>("/pro/preview", { method: "POST" }));
  return snapshot;
}

/** Hand the locks back, to see what a free account sees. */
export async function closePreviewAccess(): Promise<PreviewAccess> {
  put(await apiFetch<Wire>("/pro/preview", { method: "DELETE" }));
  return snapshot;
}

/* No local counting of messages sent. The server counts a message only once
 * it is past the gates - a clarifying question is not a message the user
 * spends - so a count kept here would drift above the real one and show an
 * allowance smaller than it is. The dialog re-reads the number when it
 * opens, which is the only moment it is on screen. */

export function usePreviewAccess(): PreviewAccess {
  useEffect(() => {
    void loadPreviewAccess();
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => LOCKED);
}

/** The modes that cannot be started right now. */
export function useLockedModes(): readonly PickableMode[] {
  const access = usePreviewAccess();
  return access.unlocked ? [] : access.modes;
}
