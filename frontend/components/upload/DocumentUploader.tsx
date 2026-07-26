"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/apiClient";
import { authErrorMessage, getAccessToken } from "@/lib/auth";

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
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={handleFileSelected}
          disabled={uploading}
          className="text-xs text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-brand file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white hover:file:bg-brand-dark disabled:opacity-60"
        />
        {uploading && <span className="text-xs text-slate-400">Uploading…</span>}
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {documents && documents.length > 0 && (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
            >
              <span className="truncate">{doc.filename}</span>
              <div className="flex items-center gap-2">
                <StatusBadge status={doc.status} />
                <button
                  type="button"
                  onClick={() => handleDelete(doc.id)}
                  className="text-slate-400 hover:text-red-500"
                  aria-label={`Delete ${doc.filename}`}
                >
                  ✕
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
  const styles: Record<DocumentItem["status"], string> = {
    uploading: "text-slate-400",
    processing: "text-amber-500",
    processed: "text-emerald-500",
    failed: "text-red-500",
  };
  return <span className={`font-medium ${styles[status]}`}>{status}</span>;
}
