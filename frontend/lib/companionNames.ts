"use client";

import { useSyncExternalStore } from "react";
import { apiFetch } from "@/lib/apiClient";

/* What the user calls their companion in each mode.
 *
 * Two unrelated components need this - the mode switcher and the mode-nudge
 * card - and neither owns the profile. A module-level store means one fetch
 * per session rather than one per component, and it is read through
 * useSyncExternalStore so a rename updates every consumer at once without a
 * context provider threaded through the shell.
 *
 * An unnamed mode is the normal case: it renders as the mode's own label, so
 * the fallback is never an empty string or a placeholder.
 */

type Names = Record<string, string>;

let snapshot: Names = {};
let loaded = false;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!loaded && !inFlight) {
    inFlight = apiFetch<{ companion_names?: Names }>("/profile")
      .then((p) => {
        snapshot = p.companion_names ?? {};
        loaded = true;
        emit();
      })
      .catch(() => {
        // A missing nickname is not worth an error state; every consumer
        // falls back to the mode's own label.
        loaded = true;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return () => {
    listeners.delete(onChange);
  };
}

const getSnapshot = () => snapshot;
// Server render has no session, so it renders the same as "nobody named
// anything" - which is what an unauthenticated visitor should see anyway.
const getServerSnapshot = () => EMPTY;
const EMPTY: Names = {};

export function useCompanionNames(): Names {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Set locally and push to the server. Optimistic: renaming your own
 *  companion should feel instant, and a failed save leaves the old name in
 *  place on the next load rather than losing anything.
 *
 *  The response is checked rather than assumed. An API that does not know
 *  this field yet accepts the request and ignores it - a 200 with the name
 *  dropped on the floor - so "Saved." would be a lie the user only discovers
 *  on their next visit. Confirming the round trip turns a silent no-op into
 *  an error the caller can show. */
export async function saveCompanionNames(next: Names): Promise<void> {
  snapshot = next;
  loaded = true;
  emit();
  const saved = await apiFetch<{ companion_names?: Names }>("/profile", {
    method: "PUT",
    body: { companion_names: next },
  });
  const echoed = saved.companion_names ?? {};
  const kept = Object.keys(next).every((k) => echoed[k] === next[k]);
  const extra = Object.keys(echoed).some((k) => !(k in next));
  if (!kept || extra) {
    throw new Error("The server did not store these names.");
  }
}

/** The name to show for a mode: the user's, or the mode's own label. */
export function companionLabel(names: Names, mode: string, fallback: string): string {
  const given = names[mode]?.trim();
  return given || fallback;
}
