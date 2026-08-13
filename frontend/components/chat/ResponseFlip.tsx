"use client";

import { useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { cx, Spinner } from "@/components/ui/primitives";
import { cleanMessageText } from "@/lib/text";

/* The Devil's Draft, as the back of the card.
 *
 * It used to be a side-by-side panel below the answer, which had two problems:
 * you had to go looking for it, and reading two columns of near-identical
 * prose is work the eye refuses to do. Flipping the answer in place puts the
 * two versions in the same rectangle, one after the other, so the difference
 * arrives as a change rather than as a comparison you have to perform.
 *
 * The counterfactual is generated alongside the answer and shipped with it, so
 * the flip is usually instant; the endpoint is only called for older messages
 * that predate that, or turns where the parallel generation failed.
 */

export function FlipIcon({ className }: { className?: string }) {
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
      {/* A card mid-turn: one face square-on, the other edge-on behind it. */}
      <rect x="3" y="5" width="11" height="14" rx="2" />
      <path d="M18 7.5v9" />
      <path d="M21 6v12" />
    </svg>
  );
}

function comparableText(text: string): string {
  return cleanMessageText(text).replace(/\s*\[\d+\]/g, "");
}

export function useCounterfactual({
  conversationId,
  messageId,
  preloaded,
}: {
  conversationId?: string;
  messageId: string;
  preloaded?: string | null;
}) {
  const [flipped, setFlipped] = useState(false);
  const [text, setText] = useState<string | null>(preloaded ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (flipped) {
      setFlipped(false);
      return;
    }
    setFlipped(true);
    if (text || loading || !conversationId) return;

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

  return { flipped, toggle, text, loading, error };
}

export function ResponseFlip({
  flipped,
  front,
  text,
  loading,
  error,
}: {
  flipped: boolean;
  front: ReactNode;
  text: string | null;
  loading: boolean;
  error: string | null;
}) {
  return (
    // perspective on the outer element, so the rotation has depth rather than
    // reading as a horizontal squash.
    <div style={{ perspective: "1600px" }}>
      {/* Both faces occupy the same grid cell, which makes the card as tall as
          the taller of the two. Absolute positioning would collapse the
          container to nothing and clip whichever face is showing. */}
      <div
        className="grid transition-transform duration-500 ease-out"
        style={{
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        <div
          className="col-start-1 row-start-1"
          style={{ backfaceVisibility: "hidden" }}
          aria-hidden={flipped}
        >
          {front}
        </div>

        <div
          className="col-start-1 row-start-1"
          style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
          aria-hidden={!flipped}
        >
          {/* Deliberately compact. Both faces share a grid cell so the card is
              as tall as the taller of them - a long explainer down here would
              pad every answer in the conversation with dead space it only
              needs while flipped. The counterfactual runs about half the
              length of the answer, so the front governs the height. */}
          <div className="rounded-xl border border-caution-border bg-caution-bg px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-caution">
              Unchecked - caveats removed
            </p>
            {loading && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-caution">
                <Spinner className="h-3 w-3" />
                Arguing the other way…
              </p>
            )}
            {error && <p className="mt-1.5 text-xs text-band-low">{error}</p>}
            {text && (
              // Ordinary reading colour for the body: a full paragraph of the
              // warning colour is a thing you skim and abandon, and this is
              // the half you are meant to read closely.
              <p className="mt-1.5 whitespace-pre-wrap leading-relaxed text-ink-secondary">
                {comparableText(text)}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FlipButton({
  flipped,
  onClick,
  className,
}: {
  flipped: boolean;
  onClick: () => void;
  className?: string;
}) {
  const label = flipped ? "Show the checked answer" : "Flip to the unchecked version";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={flipped}
      title={label}
      aria-label={label}
      className={cx(
        "rounded-md p-1 transition-colors",
        flipped ? "text-caution" : "text-ink-muted hover:bg-surface-hover hover:text-caution",
        className,
      )}
    >
      <FlipIcon className="h-3.5 w-3.5" />
    </button>
  );
}
