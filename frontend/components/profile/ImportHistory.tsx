"use client";

import { useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/apiClient";
import { authErrorMessage, getAccessToken, refreshAccessToken } from "@/lib/auth";
import { Button, Spinner } from "@/components/ui/primitives";

/* Seeding the profile from another assistant's export.
 *
 * There is no API for this - none of the three providers let a third party
 * read a user's chat history, and there is no sign that will change. What
 * they all do offer is a free data export the user requests themselves, which
 * is a better arrangement anyway: no credentials, no scraping, and the user
 * can see exactly what they are handing over before they hand it over.
 *
 * Uploaded with fetch rather than apiFetch because this is multipart, and
 * apiFetch sets a JSON content type.
 */

const WHERE_TO_GET_IT = [
  { name: "ChatGPT", path: "Settings → Data controls → Export data", file: "conversations.json" },
  { name: "Claude", path: "Settings → Privacy → Export data", file: "conversations.json" },
  { name: "Gemini", path: "takeout.google.com → My Activity", file: "MyActivity.json" },
];

type Result = { source: string; messages: number; conversations: number };

export function ImportHistory({ onImported }: { onImported?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    setResult(null);

    const body = new FormData();
    body.append("file", file);

    async function send(token: string | null) {
      return fetch(`${API_BASE_URL}/profile/import`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body,
      });
    }

    try {
      let res = await send(getAccessToken());
      if (res.status === 401) res = await send(await refreshAccessToken());

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.detail ?? "That file couldn't be read.");
      }
      setResult(payload as Result);
      onImported?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : authErrorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="rounded-xl border border-hairline bg-surface p-4">
      <h2 className="text-sm font-semibold text-ink">Bring your history with you</h2>
      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
        Already have months of conversations elsewhere? Import them and the
        companion starts knowing how you think, instead of starting from
        nothing. Only your own messages are read - the other assistant&apos;s
        replies are discarded and never stored.
      </p>

      <dl className="mt-3 space-y-1">
        {WHERE_TO_GET_IT.map((source) => (
          <div key={source.name} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
            <dt className="font-medium text-ink-secondary">{source.name}</dt>
            <dd className="text-ink-muted">
              {source.path} <span className="opacity-70">({source.file})</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={busy}>
          {busy ? "Reading…" : "Choose export file"}
        </Button>
        {busy && <Spinner className="h-3.5 w-3.5 text-ink-muted" />}
      </div>

      {result && (
        <p className="mt-2.5 text-xs leading-relaxed text-band-high">
          Imported {result.messages} of your messages from {result.source}
          {result.conversations > 0 && ` across ${result.conversations} conversations`}. Your
          profile is rebuilding now - refresh in a moment to see it.
        </p>
      )}
      {error && <p className="mt-2.5 text-xs leading-relaxed text-band-low">{error}</p>}
    </section>
  );
}
