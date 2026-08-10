"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { cx, Spinner } from "@/components/ui/primitives";

/* "Devil's Draft" - the draft before the checks, and the devil's advocate at
 * the same time. The point of showing it is that a careful answer, read alone,
 * gives you no sense of what the care cost you: hedges and counter-arguments
 * read as waffle right up until you see the confident version that leaves them
 * out, and then it's obvious which of them were load-bearing.
 *
 * Generated in parallel with the answer's own validation, so by the time the
 * message lands the comparison is already sitting on it and the panel opens
 * instantly. The endpoint remains for older messages that predate that, and
 * for any turn where the parallel generation failed. */

function DevilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Horns over a speech bubble: an argument with an agenda. */}
      <path d="M5 8V5l3 2M19 8V5l-3 2" />
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function DevilsDraft({
  conversationId,
  messageId,
  answer,
  preloaded,
}: {
  conversationId: string;
  messageId: string;
  answer: string;
  /** Generated alongside the answer and shipped with it. When present the
   *  panel opens instantly and the endpoint is never called. */
  preloaded?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(preloaded ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (text || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ counterfactual_content: string }>(
        `/chat/${conversationId}/messages/${messageId}/devils-advocate`,
        { method: "POST" },
      );
      setText(res.counterfactual_content);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="See the same answer written to persuade rather than to inform"
        className={cx(
          "-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs transition-colors",
          open
            ? "text-caution"
            : "text-ink-muted hover:bg-surface-hover hover:text-caution",
        )}
      >
        <DevilIcon className="h-3.5 w-3.5" />
        {open ? "Hide the Devil's Draft" : "Devil's Draft"}
        <span className="text-ink-muted">what this would say unchecked</span>
      </button>

      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <section className="rounded-lg border border-hairline bg-surface-muted p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-band-high">
              As written
            </h4>
            <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-secondary">
              {answer}
            </p>
          </section>

          <section className="rounded-lg border border-caution-border bg-caution-bg p-3">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-caution">
              Off the leash
            </h4>
            {loading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-caution">
                <Spinner className="h-3 w-3" />
                Arguing the other way…
              </p>
            )}
            {error && <p className="mt-1.5 text-xs text-band-low">{error}</p>}
            {text && (
              <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-caution">
                {text}
              </p>
            )}
          </section>

          <p className="text-[11px] leading-relaxed text-ink-muted sm:col-span-2">
            The right-hand version states things flatly, drops the caveats and
            leads with whatever lands hardest. It is not a second opinion — it
            is the same answer with the bias screening switched off, shown so
            you can see what the screening was doing.
          </p>
        </div>
      )}
    </div>
  );
}
