"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";

type SearchResult = {
  message_id: string;
  conversation_id: string;
  conversation_title: string | null;
  role: string;
  content: string;
  mode_used: string;
  created_at: string;
  rank: number;
};

export function HistorySearch({ workspaceId }: { workspaceId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<SearchResult[]>(
        `/history/search?workspace_id=${workspaceId}&q=${encodeURIComponent(q)}`,
      );
      setResults(data);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-slate-500">Search history</h2>
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across all conversations…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none dark:border-slate-700 dark:bg-slate-950"
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium hover:border-brand disabled:opacity-50 dark:border-slate-700"
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {results !== null && (
        <ul className="space-y-2">
          {results.length === 0 ? (
            <p className="text-sm text-slate-500">No matches found.</p>
          ) : (
            results.map((r) => (
              <li key={r.message_id}>
                <Link
                  href={`/chat/${r.conversation_id}`}
                  className="block rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm hover:border-brand dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="mb-1 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    <span>{r.conversation_title || "Untitled conversation"}</span>
                    <span>
                      {r.role} · {r.mode_used}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm text-slate-700 dark:text-slate-200">
                    {r.content}
                  </p>
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
