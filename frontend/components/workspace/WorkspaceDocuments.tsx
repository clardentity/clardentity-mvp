"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { DocumentUploader } from "@/components/upload/DocumentUploader";
import { AttachmentSearch } from "@/components/workspace/AttachmentSearch";
import { Card, PageHeader, Spinner } from "@/components/ui/primitives";

type Workspace = { id: string; name: string };

export function WorkspaceDocuments({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Workspace>(`/workspaces/${workspaceId}`)
      .then((w) => {
        if (!cancelled) setWorkspace(w);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  if (error) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Attachments"
        description={`Added to ${workspace.name}. Answers in this workspace cite these directly.`}
      />
      <Card>
        <DocumentUploader workspaceId={workspaceId} />
      </Card>

      <Card className="mt-5">
        <AttachmentSearch workspaceId={workspaceId} />
      </Card>
    </div>
  );
}
