"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import {
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";

type Workspace = {
  id: string;
  name: string;
  role: string;
  created_at: string;
};

export function WorkspaceList() {
  const router = useRouter();
  // Set only by the sign-in and registration redirects. Arriving here from
  // anywhere else - the sidebar, a breadcrumb - means the list was asked for
  // deliberately, and skipping past it would make a second workspace
  // impossible to create once you have one.
  const autoEnter = useSearchParams().get("enter") === "1";

  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);

  function fetchWorkspaces(): Promise<Workspace[]> {
    return apiFetch<Workspace[]>("/workspaces");
  }

  useEffect(() => {
    let cancelled = false;
    fetchWorkspaces()
      .then((data) => {
        if (cancelled) return;
        // Signing in should land you where you can ask something, not on a
        // list with one item on it. `replace` so Back returns to the page you
        // signed in from rather than bouncing through here again.
        if (autoEnter && data.length === 1) {
          router.replace(`/workspace/${data[0].id}`);
          return;
        }
        setWorkspaces(data);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [autoEnter, router]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await apiFetch<Workspace>("/workspaces", {
        method: "POST",
        body: { name: name.trim() },
      });
      setName("");
      setWorkspaces(await fetchWorkspaces());
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Workspaces"
        description="Each workspace keeps its own attachments, chats and history."
      />

      <Card className="mb-6">
        <form onSubmit={handleCreate} className="flex flex-wrap items-center gap-2">
          <Input
            type="text"
            placeholder="New workspace name"
            aria-label="New workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-48 flex-1"
          />
          <Button type="submit" variant="primary" disabled={creating || !name.trim()}>
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mb-4 rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      )}

      {workspaces === null ? (
        <div className="flex justify-center py-10">
          <Spinner className="text-ink-muted" />
        </div>
      ) : workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          description="Create your first workspace above to start adding attachments and asking questions."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <Link
                href={`/workspace/${ws.id}`}
                className="flex h-full items-start justify-between gap-3 rounded-xl border border-hairline bg-surface p-4 transition-colors hover:border-brand-border hover:bg-surface-hover"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-sm font-semibold text-brand">
                    {ws.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-ink">{ws.name}</span>
                    <span className="block text-xs text-ink-muted">
                      Created {new Date(ws.created_at).toLocaleDateString()}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink-muted">
                  {ws.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
