"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { ChatRowMenu } from "@/components/chat/ChatRowMenu";
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
  pinned?: boolean;
};

export function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // Every workspace the user belongs to - the destinations a chat can be
  // moved to. Fetched with the rest; an empty list just hides the control.
  const [allWorkspaces, setAllWorkspaces] = useState<Workspace[]>([]);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  // Bumped after a rename, pin or move so the list is re-read: a pin changes
  // the order, a move takes the row out of this workspace entirely.
  const [reloadKey, setReloadKey] = useState(0);
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
  }, [workspaceId, reloadKey]);

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

  /** The row menu has already deleted it; drop it from the list. */
  function forgetConversation(id: string) {
    setConversations((prev) => (prev ?? []).filter((c) => c.id !== id));
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      {conv.pinned && (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-label="Pinned"
                          className="h-3.5 w-3.5 shrink-0 text-brand"
                        >
                          <path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" />
                          <path d="M12 14v6" />
                        </svg>
                      )}
                      <span className="block truncate text-sm font-medium text-ink">
                        {conv.title || "Untitled chat"}
                      </span>
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
                <ChatRowMenu
                  conversationId={conv.id}
                  title={conv.title}
                  pinned={Boolean(conv.pinned)}
                  workspaceId={workspaceId}
                  workspaces={allWorkspaces}
                  onChanged={() => setReloadKey((n) => n + 1)}
                  onDeleted={() => forgetConversation(conv.id)}
                  className="mr-2"
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



