"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { lastWorkspaceId, rememberWorkspace } from "@/lib/lastWorkspace";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { Button } from "@/components/ui/primitives";

type Workspace = { id: string; name: string };
type Conversation = { id: string; title: string | null };

/** The way in after signing in or finishing the welcome questions: straight
 *  to a chat, in a mode, ready to type. Nobody is asked to make a workspace
 *  first (one is made for them if they have none, and the sign-in path
 *  already guarantees that) or to pick a mode before the box unlocks.
 *
 *  An empty chat left over from last time is reused rather than stacking
 *  another "Untitled chat" on the list every sign-in; a chat with anything in
 *  it is left alone and a fresh one is opened. */
export function StartChat() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // One run per attempt, and no cancellation on cleanup: StrictMode mounts
  // twice, and cancelling the first run while the ref blocks the second
  // left the page on the spinner forever. A run that outlives the component
  // is harmless - router.replace works from anywhere, and the ref stops a
  // second run from making a second chat.
  const started = useRef<number>(-1);

  useEffect(() => {
    if (started.current === attempt) return;
    started.current = attempt;

    async function go() {
      try {
        let workspaces = await apiFetch<Workspace[]>("/workspaces");
        if (workspaces.length === 0) {
          const made = await apiFetch<Workspace>("/workspaces", {
            method: "POST",
            body: { name: "My workspace" },
          });
          workspaces = [made];
        }
        const remembered = lastWorkspaceId();
        const workspace = workspaces.find((w) => w.id === remembered) ?? workspaces[0];
        rememberWorkspace(workspace.id);

        const conversations = await apiFetch<Conversation[]>(
          `/chat/conversations?workspace_id=${workspace.id}`,
        );
        // Most recently active first from the server; a null title means
        // nothing has been asked in it yet (the title is derived from the
        // first question), wherever it sits in the list.
        const empty = conversations.find((c) => c.title === null) ?? null;
        const target =
          empty ??
          (await apiFetch<Conversation>("/chat/conversations", {
            method: "POST",
            body: { workspace_id: workspace.id, default_mode: null },
          }));
        router.replace(`/chat/${target.id}`);
      } catch (err) {
        setError(authErrorMessage(err));
      }
    }

    void go();
  }, [attempt, router]);

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
        <p className="text-sm text-band-low">{error}</p>
        <Button variant="primary" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-24">
      <ThinkingIndicator label="Opening your chat" />
    </div>
  );
}
