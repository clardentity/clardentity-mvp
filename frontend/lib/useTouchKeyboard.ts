"use client";

import { useSyncExternalStore } from "react";

/* An on-screen keyboard, rather than a real one.
 *
 * Enter means two different things on the two: on a laptop it is how you
 * send (and Shift+Enter is the new line), on a phone the same key sits where
 * every other app puts "new line" and there is no Shift to hold - so
 * Enter-to-send made a paragraph impossible to type and sent half-written
 * questions instead.
 *
 * `pointer: coarse` with no hover is the pair that says touch without
 * claiming to detect a device: a laptop with a touchscreen still reports a
 * fine pointer for its trackpad and keeps Enter-to-send, which is right.
 */
const QUERY = "(pointer: coarse) and (hover: none)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function getSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/** True when the keyboard is the on-screen kind, so Enter should make a new
 *  line and the send button is the only way to send. The server snapshot is
 *  false: a page rendered for touch and corrected to desktop would rebind a
 *  key under the user's fingers. */
export function useTouchKeyboard(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
