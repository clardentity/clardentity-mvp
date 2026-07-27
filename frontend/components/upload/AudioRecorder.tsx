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
        className={`flex h-9 w-9 items-center justify-center rounded-md border text-sm disabled:opacity-50 ${
          state === "recording"
            ? "animate-pulse border-red-400 bg-red-50 text-red-600 dark:border-red-500 dark:bg-red-950"
            : "border-slate-300 text-slate-500 hover:border-brand hover:text-brand dark:border-slate-700"
        }`}
      >
        {state === "transcribing" ? "…" : "🎤"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}
