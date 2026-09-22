"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { modeLabel, type CognitiveMode } from "@/lib/modes";
import {
  Badge,
  Button,
  Card,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";

type Workspace = {
  id: string;
  name: string;
  role: string;
  created_at: string;
  last_activity_at?: string | null;
};

/** "14 Aug, 08:17" rather than "14/08/2026, 08:17:19".
 *
 *  The full timestamp is ~150px of a row that also carries a title, a mode
 *  badge and a delete button; at 360px it left the title about a dozen
 *  characters. The exact value stays in the tooltip for anyone who wants it. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    + ", "
    + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

type Conversation = {
  id: string;
  title: string | null;
  default_mode: string | null;
  created_at: string;
  last_activity_at?: string | null;
};

export function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // Every workspace the user belongs to - the destinations a chat can be
  // moved to. Fetched with the rest; an empty list just hides the control.
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [confirmingWorkspace, setConfirmingWorkspace] = useState(false);
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which mode is being started, so only the card you clicked shows a
  // pending label. `"any"` covers the plain "New chat" button.
  const [creating, setCreating] = useState<CognitiveMode | "any" | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch<Workspace>(`/workspaces/${workspaceId}`),
      apiFetch<Conversation[]>(`/chat/conversations?workspace_id=${workspaceId}`),
      apiFetch<Workspace[]>("/workspaces").catch(() => [] as Workspace[]),
    ])
      .then(([ws, convs, all]) => {
        if (cancelled) return;
        setWorkspace(ws);
        setConversations(convs);
        setAllWorkspaces(all);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  async function handleMove(conversationId: string, targetId: string) {
    if (moving) return;
    setMoving(conversationId);
    setError(null);
    try {
      await apiFetch(`/chat/conversations/${conversationId}`, {
        method: "PATCH",
        body: { workspace_id: targetId },
      });
      // It now lives elsewhere: out of this list, no refetch needed.
      setConversations((prev) => (prev ? prev.filter((c) => c.id !== conversationId) : prev));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setMoving(null);
    }
  }

  async function handleNewConversation(mode?: CognitiveMode) {
    if (creating) return;
    setCreating(mode ?? "any");
    setError(null);
    try {
      const conv = await apiFetch<Conversation>("/chat/conversations", {
        method: "POST",
        body: { workspace_id: workspaceId, default_mode: mode ?? null },
      });
      router.push(`/chat/${conv.id}`);
    } catch (err) {
      setError(authErrorMessage(err));
      setCreating(null);
    }
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      </div>
    );
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await apiFetch(`/chat/conversations/${id}`, { method: "DELETE" });
      setConversations((prev) => (prev ?? []).filter((c) => c.id !== id));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setDeleting(null);
    }
  }

  async function handleDeleteWorkspace() {
    setDeletingWorkspace(true);
    setError(null);
    try {
      await apiFetch(`/workspaces/${workspaceId}`, { method: "DELETE" });
      // The list page re-provisions a workspace on sign-in if this was the
      // last one, so there is always somewhere to land.
      router.replace("/workspace");
    } catch (err) {
      setError(authErrorMessage(err));
      setDeletingWorkspace(false);
      setConfirmingWorkspace(false);
    }
  }

  if (!workspace || conversations === null) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={workspace.name}
        description="Attachments added here ground every answer in this workspace."
        actions={
          <Button
            variant="primary"
            onClick={() => handleNewConversation()}
            disabled={creating !== null}
            data-tour="new-chat"
          >
            {creating === "any" ? "Creating…" : "New chat"}
          </Button>
        }
      />

      {/* The mode cards used to open this page - six tiles asking you to pick
          a cognitive stance before you had a question. The mode belongs to the
          message, not to the workspace, and is chosen in the composer where you can
          see what you're asking; attachments and search moved to the sidebar,
          where navigation lives. What's left is the one thing you came here
          to do and the list of what you did before. */}
      <Card padded={false} tourId="chat-list">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">Chats</h2>
          <span className="text-xs text-ink-muted">
            {conversations.length}{" "}
            {conversations.length === 1 ? "chat" : "chats"}
          </span>
        </div>

        {conversations.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-ink">No conversations yet</p>
            <p className="mt-1 text-sm text-ink-muted">
              Start one to ask questions against this workspace.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {conversations.map((conv) => (
              // The row is a link and delete is a button, so they can't nest -
              // a <button> inside an <a> is invalid and swallows the click on
              // whichever browser feels like it.
              <li
                key={conv.id}
                className="group/row flex items-center gap-1 transition-colors hover:bg-surface-hover"
              >
                <Link
                  href={`/chat/${conv.id}`}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {conv.title || "Untitled chat"}
                    </span>
                    <span
                      className="block truncate text-xs text-ink-muted"
                      title={new Date(conv.last_activity_at ?? conv.created_at).toLocaleString()}
                    >
                      {shortDate(conv.last_activity_at ?? conv.created_at)}
                    </span>
                  </span>
                  {/* Capped rather than hidden. The title has min-w-0 and
                      truncates first, so the badge can stay at every width
                      without squeezing the thing you are actually scanning
                      for - and a mode label is worth keeping when it is the
                      only way to tell two similarly-named chats apart. */}
                  {conv.default_mode && (
                    <Badge tone="neutral" className="max-w-[6.5rem] shrink-0 truncate uppercase">
                      {modeLabel(conv.default_mode)}
                    </Badge>
                  )}
                </Link>
                <MoveConversation
                  title={conv.title}
                  busy={moving === conv.id}
                  destinations={allWorkspaces.filter((w) => w.id !== workspaceId)}
                  onMove={(target) => handleMove(conv.id, target)}
                />
                <DeleteConversation
                  title={conv.title}
                  busy={deleting === conv.id}
                  onDelete={() => handleDelete(conv.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {workspace.role === "owner" && (
        // Owners only - a member leaving isn't the same operation and isn't
        // offered here. Everything in the workspace goes with it: chats,
        // attachments, memory. Same two-click confirm as every other delete.
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline px-4 py-3 sm:px-5">
          <div>
            <p className="text-sm font-medium text-ink">Delete this workspace</p>
            <p className="text-xs text-ink-muted">
              Removes every chat and attachment in it. This can&apos;t be undone.
            </p>
          </div>
          {confirmingWorkspace ? (
            <Button
              variant="danger"
              autoFocus
              onBlur={() => !deletingWorkspace && setConfirmingWorkspace(false)}
              onClick={handleDeleteWorkspace}
              disabled={deletingWorkspace}
            >
              {deletingWorkspace ? "Deleting…" : "Sure? Delete workspace"}
            </Button>
          ) : (
            <Button variant="danger" onClick={() => setConfirmingWorkspace(true)}>
              Delete workspace
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Delete, with the confirmation in the row rather than in a dialog.
 *
 *  A conversation takes its messages, claims and citations with it, so it
 *  asks first - but a modal for a row you can see is heavier than the thing
 *  it is protecting. The button becomes its own "Sure?" and reverts if you
 *  look away. */
/** "Move to…" - re-file a chat under another of the user's workspaces.
 *  A small menu on the row, same footprint as delete beside it; shown only
 *  when there is somewhere else to move it to. */
function MoveConversation({
  title,
  busy,
  destinations,
  onMove,
}: {
  title: string | null;
  busy: boolean;
  destinations: Workspace[];
  onMove: (workspaceId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const label = title || "Untitled chat";

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  if (destinations.length === 0) return null;

  return (
    <span ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Move "${label}" to another workspace`}
        aria-label={`Move "${label}" to another workspace`}
        className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
      >
        {busy ? (
          <span className="block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3" />
            <path d="M3 7v10a2 2 0 0 0 2 2h7" />
            <path d="M16 16h6m-3-3 3 3-3 3" />
          </svg>
        )}
      </button>
      {open && (
        <span
          role="menu"
          className="absolute right-0 top-full z-20 mt-1 block w-52 rounded-lg border border-hairline bg-surface-raised p-1 shadow-lg"
        >
          <span className="block px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
            Move to
          </span>
          {destinations.map((w) => (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMove(w.id);
              }}
              className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-surface-hover"
            >
              {w.name}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

function DeleteConversation({
  title,
  busy,
  onDelete,
}: {
  title: string | null;
  busy: boolean;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const label = title || "Untitled chat";

  if (confirming) {
    return (
      <span className="flex shrink-0 items-center gap-1 pr-3">
        <button
          type="button"
          onClick={onDelete}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs font-medium text-band-low transition-colors hover:bg-band-low-bg disabled:opacity-50"
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      onBlur={() => setConfirming(false)}
      title={`Delete "${label}"`}
      aria-label={`Delete "${label}"`}
      // Always visible, not hover-revealed: on a phone there is no hover, so
      // a hover-only control is simply absent - "unable to delete chats from
      // the workspace" was this, on mobile. Muted until pointed at instead.
      className="mr-2 shrink-0 rounded-md p-1.5 sm:mr-3 text-ink-muted transition-colors hover:bg-surface-hover hover:text-band-low"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}


