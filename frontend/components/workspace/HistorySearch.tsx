"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { Button, CardHeader, Input } from "@/components/ui/primitives";

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
    <div className="space-y-3">
      <CardHeader
        title="Chats"
        description="Search everything said across every conversation in this workspace."
      />

      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search across all conversations…"
          aria-label="Search conversation history"
          className="flex-1"
        />
        <Button type="submit" disabled={loading || !query.trim()}>
          {loading ? "Searching…" : "Search"}
        </Button>
      </form>

      {error && (
        <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      )}

      {results !== null &&
        (results.length === 0 ? (
          <p className="text-sm text-ink-muted">No matches found.</p>
        ) : (
          <ul className="space-y-2">
            {results.map((r) => (
              <li key={r.message_id}>
                <Link
                  href={`/chat/${r.conversation_id}`}
                  className="block rounded-lg border border-hairline bg-surface-muted px-3 py-2.5 transition-colors hover:border-brand-border hover:bg-surface-hover"
                >
                  <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-medium text-ink-muted">
                    <span className="truncate">
                      {r.conversation_title || "Untitled conversation"}
                    </span>
                    <span className="shrink-0 uppercase tracking-wide">
                      {r.role} · {r.mode_used}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm leading-relaxed text-ink-secondary">
                    {r.content}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
