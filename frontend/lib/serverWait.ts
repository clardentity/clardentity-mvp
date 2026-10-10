import { useSyncExternalStore } from "react";

/* Is the app waiting on a server that's asleep?
 *
 * The backend sleeps after a quiet spell, and the first request after that
 * can take most of a minute while it starts - with nothing on screen saying
 * why. Every API request reports in here; when one has been waiting a while
 * *and* the server hasn't answered anything recently, that's the signature of
 * a cold start rather than one slow endpoint in the middle of a session, and
 * the phone layout says so (ServerWakingNotice).
 *
 *   "none"       nothing worth mentioning
 *   "waking"     a request has waited SLOW_MS with no recent answer
 *   "still"      ...and it's still going after STILL_MS */

export type ServerWait = "none" | "waking" | "still";

const SLOW_MS = 4000;
const STILL_MS = 20000;
/** An answer within this long means the server is awake: a slow request now
 *  is just slow, not a cold start. The backend sleeps after ~15 minutes. */
const AWAKE_FOR_MS = 5 * 60 * 1000;

const pending = new Map<number, number>(); // id -> started at
let nextId = 0;
let lastAnswerAt = 0;
let stage: ServerWait = "none";
let ticker: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function compute(): ServerWait {
  if (pending.size === 0) return "none";
  const now = Date.now();
  // the oldest request started before the latest answer can't be cold any more
  if (lastAnswerAt && now - lastAnswerAt < AWAKE_FOR_MS) return "none";
  const oldest = Math.min(...pending.values());
  const waited = now - oldest;
  return waited >= STILL_MS ? "still" : waited >= SLOW_MS ? "waking" : "none";
}

function update() {
  const next = compute();
  if (pending.size === 0 && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
  if (next !== stage) {
    stage = next;
    listeners.forEach((l) => l());
  }
}

/** Wraps a request to the backend: resolves or rejects exactly as `request`
 *  does. Any answer at all - an error status included - counts as the server
 *  being awake; only a network failure doesn't. */
export function trackServerWait<T>(request: Promise<T>, answered: (value: T) => boolean = () => true): Promise<T> {
  const id = ++nextId;
  pending.set(id, Date.now());
  if (!ticker && typeof window !== "undefined") ticker = setInterval(update, 1000);
  return request.then(
    (value) => {
      if (answered(value)) lastAnswerAt = Date.now();
      pending.delete(id);
      update();
      return value;
    },
    (error) => {
      pending.delete(id);
      update();
      throw error;
    },
  );
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useServerWait(): ServerWait {
  return useSyncExternalStore(subscribe, () => stage, () => "none");
}
