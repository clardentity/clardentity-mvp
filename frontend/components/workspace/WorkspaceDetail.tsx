"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { BentoCard, BentoGrid } from "@/components/ui/bento-grid";
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
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
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
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title={workspace.name}
        description="Documents uploaded here ground every answer in this workspace."
        actions={
          <Button variant="primary" onClick={handleNewConversation} disabled={creating}>
            {creating ? "Creating…" : "New conversation"}
          </Button>
        }
      />

      <BentoGrid className="mb-5 sm:auto-rows-[14rem] lg:auto-rows-[15rem]">
        <BentoCard
          name="Documents"
          description="PDF, DOCX or TXT. Everything you upload here is what answers get cited against."
          Icon={DocIcon}
          href={`/workspace/${workspaceId}/documents`}
          cta="Manage documents"
        />
        <BentoCard
          name="Search history"
          description="Full-text search across every conversation in this workspace."
          Icon={SearchIcon}
          href={`/workspace/${workspaceId}/search`}
          cta="Search"
        />
        <BentoCard
          name="Bias library"
          description="The cognitive biases screened for in every answer, grouped by where they show up."
          Icon={BookIcon}
          href="/biases"
          cta="Browse"
        />
      </BentoGrid>

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
              Start one to ask questions against this workspace.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {conversations.map((conv) => (
              <li key={conv.id}>
                <Link
                  href={`/chat/${conv.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-surface-hover sm:px-5"
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
    </div>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}
