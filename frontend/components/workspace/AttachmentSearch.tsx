"use client";

import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { Badge, Button, CardHeader, Input, Spinner } from "@/components/ui/primitives";

/* Searching inside attachments, at one of two scopes.
 *
 * Room-wide answers "where did I read that?". Conversation-scoped answers
 * "what was this answer built on?" - a much smaller haystack, and the one you
 * want when auditing a reply rather than hunting for a half-remembered line.
 *
 * Both are literal matching, not the embedding search used for retrieval:
 * someone typing into a search box is usually after a phrase they remember,
 * and semantic nearest-neighbour is the wrong tool for recalling exact
 * wording. */

type Hit = {
  document_id: string;
  filename: string;
  chunk_index: number;
  page_number: number | null;
  excerpt: string;
  cited_here: boolean;
};

type Result = { query: string; total: number; hits: Hit[] };

export function AttachmentSearch({
  workspaceId,
  conversationId,
  compact,
}: {
  workspaceId: string;
  /** Restricts the search to attachments this conversation actually cited. */
  conversationId?: string;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoped = Boolean(conversationId);

  async function handleSearch(event: FormEvent) {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;

    setSearching(true);
    setError(null);
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId, q: term });
      if (conversationId) params.set("conversation_id", conversationId);
      setResult(await apiFetch<Result>(`/documents/search?${params}`));
    } catch (err) {
      setError(authErrorMessage(err));
      setResult(null);
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="space-y-3">
      {!compact && (
        <CardHeader
          title={scoped ? "Search this chat's sources" : "Search attachments"}
          description={
            scoped
              ? "Only the attachments this chat cited."
              : "Every attachment in this room."
          }
        />
      )}

      <form onSubmit={handleSearch} className="flex gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={scoped ? "Find a phrase in the sources" : "Find a phrase in your attachments"}
          aria-label="Search attachments"
          className="flex-1"
        />
        <Button type="submit" variant="primary" disabled={searching || !query.trim()}>
          {searching ? <Spinner className="h-4 w-4" /> : "Search"}
        </Button>
      </form>

      {error && (
        <p className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </p>
      )}

      {result && result.total === 0 && (
        <p className="rounded-lg border border-dashed border-hairline-strong bg-surface-muted px-3 py-6 text-center text-sm text-ink-muted">
          Nothing in {scoped ? "this chat's sources" : "your attachments"} matches
          &ldquo;{result.query}&rdquo;.
        </p>
      )}

      {result && result.total > 0 && (
        <>
          <p className="text-xs text-ink-muted">
            {result.total} passage{result.total === 1 ? "" : "s"}
          </p>
          <ul className="space-y-2">
            {result.hits.map((hit) => (
              <li
                key={`${hit.document_id}-${hit.chunk_index}`}
                className="rounded-lg border border-hairline bg-surface p-3"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-xs font-medium text-ink">{hit.filename}</span>
                  {hit.page_number !== null && (
                    <span className="text-[11px] text-ink-muted">page {hit.page_number}</span>
                  )}
                  {hit.cited_here && (
                    <Badge tone="brand">cited here</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{hit.excerpt}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
