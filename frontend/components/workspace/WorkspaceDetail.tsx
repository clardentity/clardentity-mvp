"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { type CognitiveMode } from "@/lib/modes";
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
};

type Conversation = {
  id: string;
  title: string | null;
  default_mode: string | null;
  created_at: string;
};

export function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which mode is being started, so only the card you clicked shows a
  // pending label. `"any"` covers the plain "New conversation" button.
  const [creating, setCreating] = useState<CognitiveMode | "any" | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch<Workspace>(`/workspaces/${workspaceId}`),
      apiFetch<Conversation[]>(`/chat/conversations?workspace_id=${workspaceId}`),
    ])
      .then(([ws, convs]) => {
        if (cancelled) return;
        setWorkspace(ws);
        setConversations(convs);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

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
        description="Attachments added here ground every answer in this room."
        actions={
          <Button
            variant="primary"
            onClick={() => handleNewConversation()}
            disabled={creating !== null}
          >
            {creating === "any" ? "Creating…" : "New conversation"}
          </Button>
        }
      />

      {/* The mode cards used to open this page - six tiles asking you to pick
          a cognitive stance before you had a question. The mode belongs to the
          message, not to the room, and is chosen in the composer where you can
          see what you're asking; attachments and search moved to the sidebar,
          where navigation lives. What's left is the one thing you came here
          to do and the list of what you did before. */}
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-3 sm:px-5">
          <h2 className="text-sm font-semibold text-ink">Conversations</h2>
          <span className="text-xs text-ink-muted">
            {conversations.length}{" "}
            {conversations.length === 1 ? "conversation" : "conversations"}
          </span>
        </div>

        {conversations.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-ink">No conversations yet</p>
            <p className="mt-1 text-sm text-ink-muted">
              Start one to ask questions against this room.
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
                  className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 sm:px-5"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">
                      {conv.title || "Untitled conversation"}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {new Date(conv.created_at).toLocaleString()}
                    </span>
                  </span>
                  {conv.default_mode && (
                    <Badge tone="neutral" className="shrink-0 uppercase">
                      {conv.default_mode}
                    </Badge>
                  )}
                </Link>
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
    </div>
  );
}

/** Delete, with the confirmation in the row rather than in a dialog.
 *
 *  A conversation takes its messages, claims and citations with it, so it
 *  asks first - but a modal for a row you can see is heavier than the thing
 *  it is protecting. The button becomes its own "Sure?" and reverts if you
 *  look away. */
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
  const label = title || "Untitled conversation";

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
      className="mr-3 shrink-0 rounded-md p-1.5 text-ink-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-band-low focus-visible:opacity-100 group-hover/row:opacity-100"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
        <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M10 11v6M14 11v6" />
      </svg>
    </button>
  );
}


