"use client";

import { useEffect, useRef, useState } from "react";
import { AvatarPanel, type Viseme } from "@/components/avatar/AvatarPanel";
import { LiveCall, type CallPhase } from "@/lib/liveCall";
import { cx } from "@/components/ui/primitives";

/* The call takes the screen.
 *
 * Everything else in this app is a document you read; a call is a thing you
 * are in. Leaving the chat visible behind a small speaking head would invite
 * you to keep reading it, which is the one thing you cannot do while talking.
 * So the transcript goes, the companion comes up to full size, and the only
 * controls are mute and hang up.
 */

const PHASE_LABEL: Record<CallPhase, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Speaking",
  ended: "Call ended",
  error: "Call failed",
};

/** Mounted only while the call is up, so "fresh state for a new call" is
 *  what the initial values already mean - no effect has to reset anything. */
export function LiveCallOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return <CallSession onClose={onClose} />;
}

function CallSession({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<CallPhase>("connecting");
  const [viseme, setViseme] = useState<Viseme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const callRef = useRef<LiveCall | null>(null);

  useEffect(() => {
    const call = new LiveCall({
      onPhase: setPhase,
      onViseme: setViseme,
      onError: setError,
    });
    callRef.current = call;
    void call.start();

    return () => {
      call.stop();
      callRef.current = null;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const speaking = phase === "speaking";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Live call"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-canvas px-6"
    >
      {/* A soft bloom behind the companion that breathes with its voice. The
          avatar is a flat SVG; this is what makes it feel like a source of
          sound rather than a picture of one. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute h-[min(70vh,34rem)] w-[min(70vh,34rem)] rounded-full transition-opacity duration-300"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--brand) 26%, transparent) 0%, transparent 66%)",
          transform: `scale(${1 + (viseme?.openness ?? 0) * 0.16})`,
          opacity: speaking ? 0.95 : 0.4,
        }}
      />

      <AvatarPanel
        state={speaking ? "speaking" : phase === "connecting" ? "thinking" : "listening"}
        gesture="none"
        expression="neutral"
        viseme={speaking ? viseme : null}
        className="relative h-[min(46vh,22rem)] w-[min(46vh,22rem)]"
      />

      <p className="relative mt-6 text-sm font-medium text-ink-secondary">
        {error ?? PHASE_LABEL[phase]}
      </p>
      {!error && phase === "listening" && (
        <p className="relative mt-1 text-xs text-ink-muted">
          Just talk - it will wait until you&apos;ve finished.
        </p>
      )}
      {!error && (
        <p className="relative mt-1 text-xs text-ink-muted">
          Answers on a call aren&apos;t cited. Ask in the chat when you need the evidence.
        </p>
      )}

      <div className="relative mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            callRef.current?.setMuted(next);
          }}
          disabled={Boolean(error)}
          aria-pressed={muted}
          className={cx(
            "flex h-12 w-12 items-center justify-center rounded-full border transition-colors disabled:opacity-40",
            muted
              ? "border-hairline bg-surface-hover text-ink"
              : "border-hairline bg-surface text-ink-secondary hover:bg-surface-hover",
          )}
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "Unmute" : "Mute"}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-5 w-5"
          >
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
            {muted && <path d="m3 3 18 18" />}
          </svg>
        </button>

        <button
          type="button"
          onClick={onClose}
          className="flex h-12 items-center gap-2 rounded-full bg-band-low px-6 text-sm font-medium text-white transition-opacity hover:opacity-90"
          aria-label="End call"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-5 w-5 rotate-[135deg]"
          >
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.9.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
          End
        </button>
      </div>
    </div>
  );
}
