"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { DocumentUploader } from "@/components/upload/DocumentUploader";

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
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

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

  async function handleNewConversation() {
    setCreating(true);
    setError(null);
    try {
      const conv = await apiFetch<Conversation>("/chat/conversations", {
        method: "POST",
        body: { workspace_id: workspaceId },
      });
      router.push(`/chat/${conv.id}`);
    } catch (err) {
      setError(authErrorMessage(err));
      setCreating(false);
    }
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!workspace || conversations === null) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-6 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">{workspace.name}</h1>
        <p className="text-sm text-slate-500">
          Upload documents to ground answers in this workspace&apos;s content.
        </p>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-medium text-slate-500">Documents</h2>
        <DocumentUploader workspaceId={workspaceId} />
      </div>

      <button
        type="button"
        onClick={handleNewConversation}
        disabled={creating}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {creating ? "Creating…" : "New conversation"}
      </button>

      {conversations.length === 0 ? (
        <p className="text-sm text-slate-500">
          No conversations yet — start one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {conversations.map((conv) => (
            <li key={conv.id}>
              <Link
                href={`/chat/${conv.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-brand dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="font-medium">
                  {conv.title || "Untitled conversation"}
                </span>
                {conv.default_mode && (
                  <span className="text-xs uppercase tracking-wide text-slate-400">
                    {conv.default_mode}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
