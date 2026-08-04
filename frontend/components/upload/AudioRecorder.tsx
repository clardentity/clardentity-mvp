"use client";

import { useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/auth";

type RecorderState = "idle" | "recording" | "transcribing";

export function AudioRecorder({
  onTranscribed,
  disabled,
}: {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        await transcribe(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setState("recording");
    } catch {
      setError("Microphone access denied or unavailable");
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setState("transcribing");
  }

  async function transcribe(blob: Blob) {
    try {
      const form = new FormData();
      form.append("file", blob, "recording.webm");

      const accessToken = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/audio/transcribe`, {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        body: form,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Transcription failed with status ${res.status}`);
      }

      const data = (await res.json()) as { transcript: string };
      onTranscribed(data.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setState("idle");
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        disabled={disabled || state === "transcribing"}
        onClick={state === "recording" ? stopRecording : startRecording}
        title={state === "recording" ? "Stop recording" : "Record a voice message"}
        aria-label={state === "recording" ? "Stop recording" : "Record a voice message"}
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          state === "recording"
            ? "animate-pulse bg-band-low-bg text-band-low"
            : "text-ink-muted hover:bg-surface-hover hover:text-brand"
        }`}
      >
        {state === "transcribing" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
          </svg>
        )}
      </button>
      {error && <p className="text-xs text-band-low">{error}</p>}
    </div>
  );
}
