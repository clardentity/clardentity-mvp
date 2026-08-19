"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { cx } from "@/components/ui/primitives";

/* The upgrade prompt, as a bento grid.
 *
 * Shown when someone reaches for a model that isn't on their plan. It is a
 * sales surface, so the honest constraint on it is that every tile has to
 * describe something we will actually ship - a locked door is annoying, a
 * locked door onto an empty room is worse.
 */

type Tile = {
  title: string;
  body: string;
  /** Column span in the 6-column grid. */
  span: string;
  accent?: boolean;
};

const TILES: Tile[] = [
  {
    title: "The full Clar range",
    body: "Clar Pro for specialist work, Clar Max for wider context and deeper checking, Clar Ultra when getting it right matters more than getting it fast. Or leave it on Auto and let Clardentity choose.",
    span: "sm:col-span-4",
    accent: true,
  },
  {
    title: "Live call",
    body: "Talk to your companion out loud, hands free.",
    span: "sm:col-span-2",
  },
  {
    title: "Unlimited attachments",
    body: "Bring your whole library. Every answer stays cited against it.",
    span: "sm:col-span-2",
  },
  {
    title: "Deeper checking",
    body: "Second-pass verification and wider web research on every claim.",
    span: "sm:col-span-2",
  },
  {
    title: "Priority speed",
    body: "Your questions go first, even at peak.",
    span: "sm:col-span-2",
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
              {trigger ? `${trigger} is part of Pro.` : "Unlock every model."}
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
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{tile.body}</p>
            </div>
          ))}
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
