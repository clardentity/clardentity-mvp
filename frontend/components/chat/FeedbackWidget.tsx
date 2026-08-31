"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { cx } from "@/components/ui/primitives";

/* "Was this helpful?" - a thumb, or a thumb and a sentence, on one answer.
 *
 * Deliberately small and quiet: this sits under every single response, so
 * anything louder than a hover-visible row of icons would be the one thing
 * you see on every message in a long thread. A rating is optimistic and
 * instant - there's nothing to wait on - and toggles off if you tap the same
 * one twice, the same contract as any other like button.
 *
 * Rating and comment are one object server-side (see PUT .../feedback), so
 * every save sends both fields together - saving a rating alone must not
 * silently erase a comment already left, and vice versa.
 */

export type MessageFeedback = { rating: "up" | "down" | null; comment: string | null };

export function FeedbackWidget({
  conversationId,
  messageId,
  feedback,
}: {
  conversationId: string;
  messageId: string;
  feedback: MessageFeedback | null;
}) {
  const [rating, setRating] = useState<"up" | "down" | null>(feedback?.rating ?? null);
  const [comment, setComment] = useState<string | null>(feedback?.comment ?? null);
  const [draft, setDraft] = useState(feedback?.comment ?? "");
  const [commentOpen, setCommentOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  async function save(next: { rating: "up" | "down" | null; comment: string | null }) {
    setSaving(true);
    try {
      await apiFetch(`/chat/${conversationId}/messages/${messageId}/feedback`, {
        method: "PUT",
        body: next,
      });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch {
      // Best-effort: a failed vote isn't worth an error banner under every
      // message. The buttons stay interactive, so trying again costs one tap.
    } finally {
      setSaving(false);
    }
  }

  function toggleRating(value: "up" | "down") {
    const next = rating === value ? null : value;
    setRating(next);
    void save({ rating: next, comment });
  }

  function submitComment() {
    const trimmed = draft.trim();
    const next = trimmed.length > 0 ? trimmed : null;
    setComment(next);
    setCommentOpen(false);
    void save({ rating, comment: next });
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5 text-[11px] text-ink-muted">
      <div className="flex items-center gap-2">
        <span>Was this helpful?</span>
        <button
          type="button"
          onClick={() => toggleRating("up")}
          disabled={saving}
          aria-pressed={rating === "up"}
          title="Helpful"
          aria-label="Mark this answer helpful"
          className={cx(
            "rounded-md p-1 transition-colors disabled:opacity-40",
            rating === "up"
              ? "text-band-high"
              : "text-ink-muted hover:bg-surface-hover hover:text-ink",
          )}
        >
          <ThumbIcon direction="up" filled={rating === "up"} />
        </button>
        <button
          type="button"
          onClick={() => toggleRating("down")}
          disabled={saving}
          aria-pressed={rating === "down"}
          title="Not helpful"
          aria-label="Mark this answer not helpful"
          className={cx(
            "rounded-md p-1 transition-colors disabled:opacity-40",
            rating === "down"
              ? "text-band-low"
              : "text-ink-muted hover:bg-surface-hover hover:text-ink",
          )}
        >
          <ThumbIcon direction="down" filled={rating === "down"} />
        </button>
        {!commentOpen && (
          <button
            type="button"
            onClick={() => {
              setDraft(comment ?? "");
              setCommentOpen(true);
            }}
            className="rounded-md px-1.5 py-0.5 text-ink-muted underline decoration-hairline-strong decoration-1 underline-offset-2 transition-colors hover:bg-surface-hover hover:text-ink"
          >
            {comment ? "Edit comment" : "Other"}
          </button>
        )}
        {justSaved && !commentOpen && <span className="text-ink-secondary">Thanks</span>}
      </div>

      {commentOpen && (
        <div className="max-w-md">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitComment();
              }
              if (e.key === "Escape") {
                setDraft(comment ?? "");
                setCommentOpen(false);
              }
            }}
            rows={2}
            autoFocus
            placeholder="What would have made this better?"
            className="w-full resize-none rounded-lg border border-hairline bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:border-brand-border focus:outline-none"
          />
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              onClick={submitComment}
              disabled={saving}
              className="rounded-full bg-brand px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-40"
            >
              Send
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(comment ?? "");
                setCommentOpen(false);
              }}
              className="rounded-full px-2 py-1 text-[11px] text-ink-secondary transition-colors hover:bg-surface-hover"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!commentOpen && comment && <p className="max-w-md text-ink-secondary">“{comment}”</p>}
    </div>
  );
}

function ThumbIcon({ direction, filled }: { direction: "up" | "down"; filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("h-3.5 w-3.5", direction === "down" && "rotate-180")}
    >
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Zm0 0 4.5-8a2 2 0 0 1 2.24.6l.16.22A3 3 0 0 1 14.4 5v4h4.13a2 2 0 0 1 1.98 2.28l-1.2 8A2 2 0 0 1 17.34 21H10a3 3 0 0 1-3-3" />
    </svg>
  );
}
