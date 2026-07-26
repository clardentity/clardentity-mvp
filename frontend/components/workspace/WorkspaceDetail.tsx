"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";

type Workspace = {
  id: string;
  name: string;
  role: string;
  created_at: string;
};

export function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Workspace>(`/workspaces/${workspaceId}`)
      .then((data) => {
        if (!cancelled) setWorkspace(data);
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
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-2 px-6 py-16">
      <h1 className="text-2xl font-semibold">{workspace.name}</h1>
      <p className="text-sm text-slate-500">
        Documents and conversations arrive in Phase 3–4 of the build.
      </p>
    </div>
  );
}
