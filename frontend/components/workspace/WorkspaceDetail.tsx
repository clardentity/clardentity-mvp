"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { DocumentUploader } from "@/components/upload/DocumentUploader";
import { HistorySearch } from "@/components/workspace/HistorySearch";
import {
  Badge,
  Button,
  Card,
  CardHeader,
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
      <div className="mx-auto w-full max-w-4xl px-6 py-8">
        <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      </div>
    );
  }

  if (!workspace || conversations === null) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <PageHeader
        title={workspace.name}
        description="Documents uploaded here ground every answer in this workspace."
        actions={
          <Button variant="primary" onClick={handleNewConversation} disabled={creating}>
            {creating ? "Creating…" : "New conversation"}
          </Button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
              <h2 className="text-sm font-semibold text-ink">Conversations</h2>
              <span className="text-xs text-ink-muted">
                {conversations.length}{" "}
                {conversations.length === 1 ? "conversation" : "conversations"}
              </span>
            </div>

            {conversations.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <p className="text-sm font-medium text-ink">No conversations yet</p>
                <p className="mt-1 text-sm text-ink-muted">
                  Start one to ask questions against this workspace.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-hairline">
                {conversations.map((conv) => (
                  <li key={conv.id}>
                    <Link
                      href={`/chat/${conv.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-hover"
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
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div id="search" className="scroll-mt-20">
            <Card>
              <HistorySearch workspaceId={workspaceId} />
            </Card>
          </div>
        </div>

        <div id="documents" className="scroll-mt-20">
          <Card>
            <CardHeader
              title="Documents"
              description="PDF, DOCX, or TXT. Answers cite these directly."
            />
            <DocumentUploader workspaceId={workspaceId} />
          </Card>
        </div>
      </div>
    </div>
  );
}
