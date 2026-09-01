"use client";

import { useState } from "react";
import { API_BASE_URL } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/auth";
import { cx, Spinner } from "@/components/ui/primitives";

/* Creative mode's "make it a real file" - turns one answer into an actual
 * Word document, slide deck, or spreadsheet.
 *
 * A raw fetch, not apiFetch: the response here is file bytes, not JSON, and
 * apiFetch always parses the body as JSON on success (see handlePlayAudio in
 * ChatView.tsx for the same pattern already in use for TTS audio).
 */

const FORMATS: { value: "docx" | "pptx" | "xlsx"; label: string }[] = [
  { value: "docx", label: "Word document" },
  { value: "pptx", label: "Slide deck" },
  { value: "xlsx", label: "Spreadsheet" },
];

export function ExportFileMenu({
  conversationId,
  messageId,
}: {
  conversationId: string;
  messageId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busyFormat, setBusyFormat] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: "docx" | "pptx" | "xlsx") {
    setError(null);
    setBusyFormat(format);
    try {
      const accessToken = getAccessToken();
      const res = await fetch(
        `${API_BASE_URL}/chat/${conversationId}/messages/${messageId}/export-file`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify({ format }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Couldn't generate the file");
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? `document.${format}`;

      // The standard blob-download trick: an off-DOM link with the file as an
      // object URL, clicked programmatically. The URL is revoked right after
      // - the browser has already read it by the time click() returns.
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't generate the file");
    } finally {
      setBusyFormat(null);
    }
  }

  return (
    <div className="mt-1.5 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-md px-1.5 py-0.5 text-ink-muted underline decoration-hairline-strong decoration-1 underline-offset-2 transition-colors hover:bg-surface-hover hover:text-ink"
      >
        Save as file
      </button>

      {open && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => download(f.value)}
              disabled={busyFormat !== null}
              className={cx(
                "flex items-center gap-1 rounded-full border border-hairline-strong px-2.5 py-1 text-ink-secondary transition-colors",
                "hover:bg-surface-hover hover:text-ink disabled:opacity-50",
              )}
            >
              {busyFormat === f.value && <Spinner className="h-3 w-3" />}
              {f.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="mt-1 text-band-low">{error}</p>}
    </div>
  );
}
