"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/apiClient";
import { authErrorMessage, getAccessToken } from "@/lib/auth";
import { Badge, Spinner } from "@/components/ui/primitives";

type DocumentItem = {
  id: string;
  filename: string;
  file_type: string | null;
  status: "uploading" | "processing" | "processed" | "failed";
  created_at: string;
};

const POLL_INTERVAL_MS = 2000;

export function DocumentUploader({ workspaceId }: { workspaceId: string }) {
  const [documents, setDocuments] = useState<DocumentItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchDocuments = useCallback((): Promise<DocumentItem[]> => {
    return apiFetch<DocumentItem[]>(`/documents?workspace_id=${workspaceId}`);
  }, [workspaceId]);

  useEffect(() => {
    let cancelled = false;
    fetchDocuments()
      .then((data) => {
        if (!cancelled) setDocuments(data);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDocuments]);

  // Poll while any document is still processing so status updates without a manual refresh.
  useEffect(() => {
    if (!documents || !documents.some((d) => d.status === "processing" || d.status === "uploading")) {
      return;
    }
    const interval = setInterval(() => {
      fetchDocuments()
        .then(setDocuments)
        .catch(() => {
          // transient poll failure — try again next tick
        });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [documents, fetchDocuments]);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);

    try {
      const form = new FormData();
      form.append("workspace_id", workspaceId);
      form.append("file", file);

      const accessToken = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/documents/upload`, {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: form,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Upload failed with status ${res.status}`);
      }

      const data = await fetchDocuments();
      setDocuments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleDelete(documentId: string) {
    try {
      await apiFetch(`/documents/${documentId}`, { method: "DELETE" });
      const data = await fetchDocuments();
      setDocuments(data);
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={handleFileSelected}
          disabled={uploading}
          aria-label="Upload a document"
          className="w-full text-xs text-ink-muted file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-xs file:font-medium file:text-white hover:file:bg-brand-dark disabled:opacity-60"
        />
        {uploading && <Spinner className="shrink-0 text-ink-muted" />}
      </div>

      {error && <p className="text-xs text-band-low">{error}</p>}

      {documents && documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-hairline bg-surface-muted px-3 py-2"
            >
              <span className="truncate text-xs text-ink">{doc.filename}</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <StatusBadge status={doc.status} />
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  className="rounded p-0.5 text-ink-muted transition-colors hover:text-band-low"
                  aria-label={`Delete ${doc.filename}`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    aria-hidden="true"
                    className="h-3 w-3"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentItem["status"] }) {
  const tones: Record<DocumentItem["status"], "neutral" | "mid" | "high" | "low"> = {
    uploading: "neutral",
    processing: "mid",
    processed: "high",
    failed: "low",
  };
  return <Badge tone={tones[status]}>{status}</Badge>;
}
