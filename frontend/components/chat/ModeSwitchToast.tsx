"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";

/* Smart switching told you after the fact, in a banner. This tells you as
 * it happens: "Switched to Decision-making" over the composer while the new
 * answer is being written, with a ring counting ten seconds down and one
 * button to stop that answer and have the question answered in the mode you
 * had chosen instead ("Stay in Finder", the client's wording). When the
 * ring runs out the card goes; the way back for the *next* question stays
 * in the banner. */

const SECONDS = 10;
const R = 9;
const CIRCUMFERENCE = 2 * Math.PI * R;

export function ModeSwitchToast({
  from,
  to,
  onRevert,
  onDismiss,
}: {
  from: string;
  to: string;
  onRevert: () => void;
  onDismiss: () => void;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const [left, setLeft] = useState(SECONDS);

  // One countdown per mount. `onDismiss` is a dependency, so the parent
  // passes a stable callback (a setState setter) rather than an inline
  // closure, or the timer would restart on every render.
  useEffect(() => {
    const started = Date.now();
    const tick = setInterval(() => {
      const remaining = Math.max(0, SECONDS - Math.floor((Date.now() - started) / 1000));
      setLeft(remaining);
    }, 250);
    const done = setTimeout(onDismiss, SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
    };
  }, [onDismiss]);

  return (
    <div
      role="status"
      className="flex shrink-0 items-center gap-3 rounded-xl border border-brand-border bg-brand-soft px-3 py-2 text-sm text-ink shadow-lg animate-[fade-in_0.25s_ease]"
    >
      <span className="relative flex h-6 w-6 shrink-0 items-center justify-center" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="h-6 w-6 -rotate-90">
          <circle cx="12" cy="12" r={R} fill="none" stroke="var(--brand-border)" strokeWidth="2" />
          <circle
            cx="12"
            cy="12"
            r={R}
            fill="none"
            stroke="var(--brand)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            // The ring empties over the ten seconds. Under reduced motion it
            // steps once a second with the number instead of sweeping.
            strokeDashoffset={reducedMotion ? CIRCUMFERENCE * (1 - left / SECONDS) : 0}
            style={
              reducedMotion
                ? undefined
                : { animation: `mode-switch-countdown ${SECONDS}s linear forwards` }
            }
          />
        </svg>
        <span className="absolute text-[9px] font-semibold tabular-nums text-brand">{left}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">Switched to {to}</span>
        <span className="text-ink-secondary"> - it suits this question better.</span>
      </span>
      <button
        type="button"
        onClick={onRevert}
        className="shrink-0 rounded-lg border border-brand-border bg-surface px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-surface-hover"
      >
        Stay in {from}
      </button>
    </div>
  );
}
