"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { cx } from "@/components/ui/primitives";

/* The chat row's own menu.
 *
 * Every list of chats - the sidebar's recents and the workspace page - used
 * to carry its own loose controls: a bin here, a folder icon there, and no
 * way at all to rename or pin. Four verbs in a row is a toolbar on something
 * that is meant to be a name you click. They live behind one "..." now, and
 * both lists use this component, so the chat you are looking at offers the
 * same four things wherever you found it.
 *
 * Delete still asks, in place: a chat takes its messages, claims and
 * citations with it, and a modal for a row you can see is heavier than the
 * thing it protects.
 */

export type ChatRowWorkspace = { id: string; name: string };

type Action = "menu" | "move" | "rename" | "confirm-delete";

function Kebab({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <circle cx="12" cy="5" r="1.75" />
      <circle cx="12" cy="12" r="1.75" />
      <circle cx="12" cy="19" r="1.75" />
    </svg>
  );
}

function PinIcon({ className }: { className?: string }) {
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
      <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
      <path d="M12 14v6" />
    </svg>
  );
}

export function ChatRowMenu({
  conversationId,
  title,
  pinned,
  workspaceId,
  workspaces,
  onChanged,
  onDeleted,
  align = "right",
  className,
}: {
  conversationId: string;
  title: string | null;
  pinned: boolean;
  /** The workspace it is in now, so it isn't offered as a destination. */
  workspaceId: string | null;
  /** Every workspace the user belongs to. "Move to" hides when there is
   *  nowhere else to go. */
  workspaces: ChatRowWorkspace[];
  /** Called after a rename, pin or move lands, so the list can re-read. */
  onChanged?: () => void;
  /** Called after a delete lands - separately, because a list usually wants
   *  to drop the row rather than refetch, and the page you are on may be the
   *  chat that just went. */
  onDeleted?: () => void;
  align?: "left" | "right";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Action>("menu");
  const [draft, setDraft] = useState(title ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const label = title || "Untitled chat";
  const destinations = workspaces.filter((w) => w.id !== workspaceId);

  /* Opening and closing resets here rather than in an effect: reopening
     should offer the menu again, not whichever panel was showing when it
     closed, and the rename field should hold the name as it is now. Doing it
     at the event is one render; doing it in an effect is a second one. */
  const setOpenState = useCallback((next: boolean) => {
    setOpen(next);
    setView("menu");
    setError(null);
    if (next) setDraft(title ?? "");
  }, [title]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpenState(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenState(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open, setOpenState]);


  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/chat/conversations/${conversationId}`, { method: "PATCH", body });
      setOpenState(false);
      onChanged?.();
    } catch {
      setError("That didn't save - try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/chat/conversations/${conversationId}`, { method: "DELETE" });
      setOpenState(false);
      onDeleted?.();
    } catch {
      setError("That didn't delete - try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  const item =
    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover disabled:opacity-50";

  return (
    <span ref={ref} className={cx("relative shrink-0", className)}>
      <button
        type="button"
        onClick={() => setOpenState(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Options for "${label}"`}
        aria-label={`Options for "${label}"`}
        // Always visible, never hover-revealed: a hover-only control does not
        // exist on a touch screen, which is where most of these lists are read.
        className="rounded-md p-1.5 text-ink-muted/80 transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <Kebab className="h-4 w-4" />
      </button>

      {open && (
        <span
          role="menu"
          className={cx(
            "absolute top-full z-30 mt-1 block w-56 rounded-lg border border-hairline bg-surface-raised p-1 shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {view === "menu" && (
            <>
              {destinations.length > 0 && (
                <button type="button" role="menuitem" className={item} onClick={() => setView("move")}>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-ink-muted"
                  >
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3" />
                    <path d="M3 7v10a2 2 0 0 0 2 2h7" />
                    <path d="M16 16h6m-3-3 3 3-3 3" />
                  </svg>
                  Move to workspace
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                className={item}
                disabled={busy}
                onClick={() => void patch({ pinned: !pinned })}
              >
                <PinIcon className={cx("h-4 w-4 shrink-0", pinned ? "text-brand" : "text-ink-muted")} />
                {pinned ? "Unpin" : "Pin to top"}
              </button>
              <button type="button" role="menuitem" className={item} onClick={() => setView("rename")}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-ink-muted"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                Rename
              </button>
              <button
                type="button"
                role="menuitem"
                className={cx(item, "text-band-low hover:bg-band-low-bg")}
                onClick={() => setView("confirm-delete")}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0"
                >
                  <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
                </svg>
                Delete
              </button>
            </>
          )}

          {view === "move" && (
            <>
              <span className="block px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Move to
              </span>
              {destinations.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  role="menuitem"
                  disabled={busy}
                  onClick={() => void patch({ workspace_id: w.id })}
                  className={cx(item, "truncate")}
                >
                  {w.name}
                </button>
              ))}
            </>
          )}

          {view === "rename" && (
            <form
              className="p-1"
              onSubmit={(e) => {
                e.preventDefault();
                void patch({ title: draft });
              }}
            >
              <label className="block px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Chat name
              </label>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={120}
                autoFocus
                placeholder="Untitled chat"
                className="w-full rounded-md border border-hairline bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-brand-border"
              />
              <span className="mt-1.5 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="rounded-md bg-brand px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </span>
            </form>
          )}

          {view === "confirm-delete" && (
            <span className="block p-1">
              <span className="block px-1 pb-1.5 text-xs leading-relaxed text-ink-secondary">
                Delete <span className="font-medium text-ink">{label}</span> and everything in it?
              </span>
              <span className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setView("menu")}
                  className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void remove()}
                  className="rounded-md bg-band-low px-2.5 py-1 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60"
                >
                  {busy ? "Deleting…" : "Delete"}
                </button>
              </span>
            </span>
          )}

          {error && <span className="block px-2 py-1 text-[11px] text-band-low">{error}</span>}
        </span>
      )}
    </span>
  );
}
