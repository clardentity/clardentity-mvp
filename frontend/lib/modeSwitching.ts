"use client";

import { useSyncExternalStore } from "react";

/* Smart vs manual mode switching.
 *
 * Smart (the default): when a question clearly fits a different mode, the
 * companion stops before answering and offers the switch - "Switching to X
 * mode because it suits this better", Ok / Stay. Manual: it never offers;
 * the mode is whatever the user picked, full stop. Same localStorage-backed
 * store shape as the sidebar collapse and the tour, for the same reasons. */

const STORAGE_KEY = "clardentity-mode-switching";

let snapshot: boolean | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): boolean {
  if (snapshot === null) {
    try {
      snapshot = localStorage.getItem(STORAGE_KEY) !== "manual";
    } catch {
      snapshot = true;
    }
  }
  return snapshot;
}

export function setSmartSwitching(next: boolean) {
  snapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "smart" : "manual");
  } catch {
    // Preference just won't survive a reload; nothing else depends on it.
  }
  listeners.forEach((fn) => fn());
}

/** True when the companion may propose a better-suited mode before answering. */
export function useSmartSwitching(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
