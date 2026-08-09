"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  PageHeader,
  Spinner,
  cx,
} from "@/components/ui/primitives";

type Bias = {
  id: string;
  name: string;
  definition: string;
  example: string;
  categories: string[];
  variants: string[];
  defined: boolean;
};

type BiasCategory = {
  id: string;
  index: number;
  name: string;
  scenario: string;
  bias_count: number;
};

const PAGE_SIZE = 60;

export function BiasLibrary() {
  const searchParams = useSearchParams();
  // The evidence panel deep-links here with ?focus=<bias_id> when a reader
  // clicks a detected bias, so that entry opens expanded and scrolled into view.
  const focusId = searchParams?.get("focus") ?? null;

  const [categories, setCategories] = useState<BiasCategory[]>([]);
  const [biases, setBiases] = useState<Bias[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [definedOnly, setDefinedOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(focusId);
  const [error, setError] = useState<string | null>(null);
  const focusRef = useRef<HTMLLIElement>(null);

  // `loading` is derived rather than a flag flipped inside the effect:
  // setting state synchronously in an effect body triggers a cascading render.
  // Whenever the query key differs from the last one we finished loading,
  // a request is in flight.
  const queryKey = `${debouncedQuery.trim()}|${activeCategory ?? ""}|${definedOnly}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = loadedKey !== queryKey;

  useEffect(() => {
    apiFetch<BiasCategory[]>("/biases/categories")
      .then(setCategories)
      .catch((err) => setError(authErrorMessage(err)));
  }, []);

  // Debounced so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
    if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
    if (activeCategory) params.set("category", activeCategory);
    if (definedOnly) params.set("defined_only", "true");

    apiFetch<{ total: number; biases: Bias[] }>(`/biases?${params}`)
      .then((data) => {
        if (cancelled) return;
        setBiases(data.biases);
        setTotal(data.total);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(queryKey);
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, activeCategory, definedOnly, queryKey]);

  // A focused bias may not be in the default page; fetch it directly so the
  // deep link always resolves rather than silently showing nothing.
  useEffect(() => {
    if (!focusId) return;
    apiFetch<Bias>(`/biases/${focusId}`)
      .then((b) => {
        setBiases((prev) =>
          prev && prev.some((x) => x.id === b.id) ? prev : [b, ...(prev ?? [])],
        );
        setExpanded(b.id);
      })
      .catch(() => {
        // A stale link just shows the unfiltered list.
      });
  }, [focusId]);

  useEffect(() => {
    if (focusId && focusRef.current) {
      focusRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focusId, biases]);

  const categoryById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Bias library"
        description="The cognitive biases Clardentity screens for, grouped by the everyday situations they show up in."
      />

      <Card className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or definition…"
            aria-label="Search biases"
            className="min-w-56 flex-1"
          />
          <label className="flex select-none items-center gap-2 rounded-lg border border-hairline-strong px-3 py-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={definedOnly}
              onChange={(e) => setDefinedOnly(e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Defined only
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={cx(
              "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              activeCategory === null
                ? "border-brand bg-brand text-white"
                : "border-hairline-strong text-ink-secondary hover:bg-surface-hover",
            )}
          >
            All domains
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveCategory(c.id === activeCategory ? null : c.id)}
              title={c.scenario}
              className={cx(
                "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                c.id === activeCategory
                  ? "border-brand bg-brand text-white"
                  : "border-hairline-strong text-ink-secondary hover:bg-surface-hover",
              )}
            >
              {c.name}
              <span className="ml-1.5 opacity-60">{c.bias_count}</span>
            </button>
          ))}
        </div>
      </Card>

      {activeCategory && categoryById.get(activeCategory) && (
        <p className="mb-4 text-sm text-ink-muted">
          <span className="font-medium text-ink-secondary">When this applies: </span>
          {categoryById.get(activeCategory)!.scenario}
        </p>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      )}

      <div className="mb-3 flex items-center justify-between text-sm text-ink-muted">
        <span>
          {loading
            ? "Searching…"
            : `${total} ${total === 1 ? "bias" : "biases"}${
                total > PAGE_SIZE ? ` · showing first ${PAGE_SIZE}` : ""
              }`}
        </span>
      </div>

      {loading && biases === null ? (
        <div className="flex justify-center py-10">
          <Spinner className="text-ink-muted" />
        </div>
      ) : biases && biases.length === 0 ? (
        <EmptyState
          title="No biases match"
          description="Try a different search term or clear the domain filter."
          action={
            <Button
              onClick={() => {
                setQuery("");
                setActiveCategory(null);
                setDefinedOnly(false);
              }}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {(biases ?? []).map((b) => {
            const isOpen = expanded === b.id;
            return (
              <li
                key={b.id}
                ref={b.id === focusId ? focusRef : undefined}
                className={cx(
                  "rounded-xl border bg-surface transition-colors",
                  b.id === focusId ? "border-brand-border" : "border-hairline",
                )}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : b.id)}
                  aria-expanded={isOpen}
                  className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{b.name}</span>
                    {!isOpen && b.definition && (
                      <span className="mt-0.5 line-clamp-1 block text-xs text-ink-muted">
                        {b.definition}
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {!b.defined && <Badge tone="neutral">No definition</Badge>}
                    {b.categories.slice(0, 1).map((cid) => (
                      <Badge key={cid} tone="brand" className="hidden sm:inline-flex">
                        {categoryById.get(cid)?.name ?? cid}
                      </Badge>
                    ))}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-hairline px-4 py-3">
                    {b.definition ? (
                      <p className="text-sm leading-relaxed text-ink-secondary">
                        {b.definition}
                      </p>
                    ) : (
                      <p className="text-sm italic text-ink-muted">
                        This bias appears in the domain taxonomy but has no written
                        definition in the source material, so it is never used for
                        screening.
                      </p>
                    )}

                    {b.example && (
                      <div className="mt-3 rounded-lg border border-hairline bg-surface-muted p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                          Example
                        </p>
                        <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
                          {b.example}
                        </p>
                      </div>
                    )}

                    {(b.categories.length > 0 || b.variants.length > 0) && (
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {b.categories.map((cid) => (
                          <Badge key={cid} tone="brand">
                            {categoryById.get(cid)?.name ?? cid}
                          </Badge>
                        ))}
                        {b.variants.map((v) => (
                          <Badge key={v} tone="neutral">
                            {v}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
