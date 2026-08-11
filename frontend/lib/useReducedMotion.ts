"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** Whether the user has asked for less motion.
 *
 *  Read through useSyncExternalStore rather than an effect: matchMedia is
 *  external state, and mirroring it into useState means writing state from an
 *  effect body, which is a cascading render (and a lint error in this repo).
 *
 *  The server snapshot is `true` - assume reduced motion until proven
 *  otherwise. Guessing the other way means the server renders something
 *  animated and the client has to take it away, which is exactly the jolt the
 *  setting exists to prevent.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}
