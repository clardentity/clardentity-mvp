import { COGNITIVE_MODES, COMING_SOON_MODES, DEFAULT_MODE, type CognitiveMode } from "@/lib/modes";

/** The mode a new chat opens in: whatever this device last asked a question
 *  in, else the default. Written when a message is sent, read once when a
 *  chat mounts - never rendered from, so a plain key rather than a store. A
 *  remembered mode that has since gone coming-soon (or away) falls back. */
const KEY = "clardentity-last-mode";

export function rememberMode(mode: CognitiveMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage blocked - the next chat opens in the default.
  }
}

export function initialMode(): CognitiveMode {
  try {
    const stored = localStorage.getItem(KEY);
    const known = COGNITIVE_MODES.find((m) => m.value === stored);
    if (known && !COMING_SOON_MODES.includes(known.value)) return known.value;
  } catch {
    // fall through
  }
  return DEFAULT_MODE;
}
