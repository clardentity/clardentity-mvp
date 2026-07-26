"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";

type Workspace = {
  id: string;
  name: string;
  role: string;
  created_at: string;
};

export function WorkspaceList() {
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
        if (!cancelled) setWorkspaces(data);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const data = await fetchWorkspaces();
      setWorkspaces(data);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Your workspaces</h1>
        <p className="text-sm text-slate-500">
          Each workspace has its own documents and conversations.
        </p>
      </div>

      <form
        onSubmit={handleCreate}
        className="flex gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
      >
        <input
          type="text"
          placeholder="New workspace name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {creating ? "Creating…" : "Create"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {workspaces === null ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : workspaces.length === 0 ? (
        <p className="text-sm text-slate-500">
          No workspaces yet — create your first one above.
        </p>
      ) : (
        <ul className="space-y-2">
          {workspaces.map((ws) => (
            <li key={ws.id}>
              <Link
                href={`/workspace/${ws.id}`}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-brand dark:border-slate-800 dark:bg-slate-900"
              >
                <span className="font-medium">{ws.name}</span>
                <span className="text-xs uppercase tracking-wide text-slate-400">
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
