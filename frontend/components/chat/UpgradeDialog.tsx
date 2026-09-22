"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { cx } from "@/components/ui/primitives";
import {
  closePreviewAccess,
  loadPreviewAccess,
  openPreviewAccess,
  usePreviewAccess,
} from "@/lib/previewAccess";

/* The upgrade prompt, as a bento grid.
 *
 * Shown when someone reaches for a model that isn't on their plan. It is a
 * sales surface, so the honest constraint on it is that every tile has to
 * describe something we will actually ship - a locked door is annoying, a
 * locked door onto an empty room is worse.
 */

type Tile = {
  title: string;
  /** The companions this tier opens - named, per the client, rather than
   *  counted, so someone can see whether the one they wanted is in it. */
  companions: string;
  body: string;
  span: string;
  accent?: boolean;
};

/* The four plans as specified by the client (features subject to change on
 * their side). Presentational only until billing exists: nothing here is
 * enforced, and "Notify me" is the only action. Each tier lets you choose
 * which companions you keep, up to its count; Basic's three are fixed. */
const TILES: Tile[] = [
  {
    title: "Clar-Basic · Free",
    companions: "Finder and Thought coach",
    body: "A daily allowance of prompts, no card needed - and a bonus day's allowance when you sign up. Bring your profile over from another assistant.",
    span: "sm:col-span-3",
  },
  {
    title: "Clar-Pro · $20/mo",
    companions: "Any 5 of the 8 companions",
    body: "Your pick - Decision-making and Co-Creative are the usual additions. 2,000 premium credits a month.",
    span: "sm:col-span-3",
    accent: true,
  },
  {
    title: "Clar-Max · $40/mo",
    companions: "Any 7 of the 8 companions",
    body: "Plus your choice of model and version in Co-Creative. 5,500 elite credits a month.",
    span: "sm:col-span-3",
  },
  {
    title: "Clar-Ultra · $100/mo · Teams",
    companions: "All 8 companions",
    body: "Everything in Max for a whole organisation - shared workspaces, co-working and team controls - with model choice in Co-Creative. 13,000 ultra-elite credits a month.",
    span: "sm:col-span-3",
  },
];

export function UpgradeDialog({
  open,
  onClose,
  trigger,
}: {
  open: boolean;
  onClose: () => void;
  /** Which locked model was clicked, so the headline can name it. */
  trigger?: string | null;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [registered, setRegistered] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Billing does not exist yet, so the locks are the only thing keeping
  // testers out of the modes we most need feedback on. "Skip for now" opens
  // them for this account against a daily allowance the server counts.
  const preview = usePreviewAccess();
  const [opening, setOpening] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  async function togglePreview(open: boolean) {
    setOpening(true);
    setPreviewError(null);
    try {
      if (open) {
        await openPreviewAccess();
      } else {
        await closePreviewAccess();
      }
    } catch {
      setPreviewError("Couldn't reach the server - try again in a moment.");
    } finally {
      setOpening(false);
    }
  }

  async function notifyMe() {
    setBusy(true);
    try {
      const res = await apiFetch<{ email: string }>("/pro/interest", {
        method: "POST",
        body: { model: trigger?.toLowerCase() ?? null },
      });
      setRegistered(res.email);
    } catch {
      // Recording interest is not something the user can fix or should be
      // told about; closing is the honest fallback for a button whose only
      // job was to say "yes, I want this".
      onClose();
    } finally {
      setBusy(false);
    }
  }

  // Re-read on open: the allowance is spent by sending messages, which
  // happens while this dialog is closed.
  useEffect(() => {
    if (open) void loadPreviewAccess(true);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // Focus moves into the dialog so Escape and Tab belong to it rather than
    // to the composer behind it.
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Upgrade to Clardentity Pro"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      <div className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-hairline bg-surface-raised p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
              Clardentity Pro
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-ink">
              {trigger ? `${trigger} is part of Pro.` : "Unlock every mode and model."}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {/* Was "add the models you already trust", which made sense when
                  these rows carried other vendors' names. They are Clar tiers
                  now and nobody trusts them yet - the pitch is depth, not
                  familiarity. */}
              Keep the companion that shows its work. Give it more to work with.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-5 grid gap-2.5 sm:grid-cols-6">
          {TILES.map((tile) => (
            <div
              key={tile.title}
              className={cx(
                "rounded-xl border p-3.5",
                tile.span,
                tile.accent
                  ? "border-brand-border bg-brand-soft"
                  : "border-hairline bg-surface-muted",
              )}
            >
              <p
                className={cx(
                  "text-sm font-semibold",
                  tile.accent ? "text-brand" : "text-ink",
                )}
              >
                {tile.title}
              </p>
              <p className="mt-1 text-xs font-medium text-ink">{tile.companions}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{tile.body}</p>
            </div>
          ))}
        </div>

        {/* The testing door. Stated plainly rather than dressed as an offer:
            these are paid-tier companions, and this is a way to try them
            while there is nothing to pay with. */}
        <div className="mt-4 rounded-xl border border-hairline bg-surface-muted p-3.5">
          {preview.unlocked ? (
            <>
              <p className="text-sm font-medium text-ink">
                The paid companions are open on this account.
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                {preview.remainingToday} of {preview.dailyLimit} messages left today
                in Mentoring, Reflect &amp; Relieve, Co-Creative and Legal. The
                allowance resets daily and doesn&apos;t touch the other companions.
              </p>
              <button
                type="button"
                onClick={() => void togglePreview(false)}
                disabled={opening}
                className="mt-2.5 rounded-full border border-hairline px-3 py-1.5 text-xs font-medium text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
              >
                {opening ? "Closing…" : "Lock them again"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-ink">
                Want to try them while Pro is being built?
              </p>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                Open every companion on this account with a daily message allowance -
                no card, nothing to cancel.
              </p>
              <button
                type="button"
                onClick={() => void togglePreview(true)}
                disabled={opening}
                className="mt-2.5 rounded-full border border-brand-border bg-brand-soft px-3.5 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand hover:text-white disabled:opacity-60"
              >
                {opening ? "Opening…" : "Skip for now - let me use them"}
              </button>
            </>
          )}
          {previewError && <p className="mt-2 text-xs text-band-low">{previewError}</p>}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          {/* The old copy said "leave your address" beside a dialog with no
              address field and a button that only closed it. The caller is
              signed in, so the address is already known - the button now
              records the interest and says where the mail will go. */}
          <p className="text-xs text-ink-muted">
            {registered
              ? `You're on the list. We'll email ${registered} when Pro opens.`
              : "Pro is not open yet."}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-3.5 py-2 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              {registered ? "Close" : "Not now"}
            </button>
            {!registered && (
              <button
                type="button"
                onClick={notifyMe}
                disabled={busy}
                className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
              >
                {busy ? "Adding…" : "Notify me"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
