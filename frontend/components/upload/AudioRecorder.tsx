"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "@/lib/apiClient";
import { getAccessToken } from "@/lib/auth";
import { cx } from "@/components/ui/primitives";

type RecorderState = "idle" | "recording" | "transcribing";

type TranscribeResponse = {
  transcript: string;
  language?: string | null;
  heard_speech?: boolean;
};

/** Languages the transcript is quietly accepted in. Anything else gets a
 *  visible "heard this as X" note, because an unclear recording is
 *  transcribed confidently in the wrong language rather than flagged - and
 *  the person can't tell from the text that this happened until they read
 *  it back. */
const EXPECTED_LANGUAGES = new Set(["english", "en"]);

/** Recording formats in order of preference. Chrome and Firefox record
 *  webm/opus; iPhone Safari can only record mp4 (AAC), and a file it made
 *  labelled webm is a file the server can't read. */
const RECORDING_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function pickRecordingType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") {
    return undefined;
  }
  return RECORDING_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** The file name the upload carries, with the extension that matches what
 *  was actually recorded - the server goes by it. */
function recordingFileName(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes("mp4") || t.includes("aac") || t.includes("m4a")) return "recording.m4a";
  if (t.includes("ogg")) return "recording.ogg";
  return "recording.webm";
}

function titleCase(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function AudioRecorder({
  onTranscribed,
  disabled,
}: {
  onTranscribed: (text: string) => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Elapsed-time counter while recording: a number that changes is the one
  // unambiguous sign that recording is actually happening, more than any
  // colour change is.
  useEffect(() => {
    if (state !== "recording") return;
    const startedAt = Date.now();
    const id = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    return () => window.clearInterval(id);
  }, [state]);

  async function startRecording() {
    setError(null);
    setNotice(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = pickRecordingType();
      const recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        // What the recorder says it made, then what its chunks say, then
        // what was asked for - Safari can leave recorder.mimeType empty.
        const type = recorder.mimeType || chunksRef.current[0]?.type || preferred || "audio/webm";
        const blob = new Blob(chunksRef.current, { type });
        await transcribe(blob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setSeconds(0);
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
      form.append("file", blob, recordingFileName(blob.type));

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

      const data = (await res.json()) as TranscribeResponse;
      if (data.heard_speech === false || !data.transcript.trim()) {
        // Silence used to come back as "Thank you for watching" and land in
        // the composer as if you'd said it. Say what happened instead.
        setNotice("Didn't catch any speech - try again, a little closer to the mic.");
        return;
      }
      const lang = (data.language || "").toLowerCase();
      if (lang && !EXPECTED_LANGUAGES.has(lang)) {
        setNotice(
          `Heard this as ${titleCase(lang)}. If that's not what you said, record again.`,
        );
      }
      onTranscribed(data.transcript);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed");
    } finally {
      setState("idle");
    }
  }

  const recording = state === "recording";
  const mm = String(Math.floor(seconds / 60));
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        data-tour="voice"
        disabled={disabled || state === "transcribing"}
        onClick={recording ? stopRecording : startRecording}
        title={recording ? "Stop recording" : "Record a voice message"}
        aria-label={recording ? `Stop recording (${mm}:${ss})` : "Record a voice message"}
        aria-pressed={recording}
        className={cx(
          "flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          recording
            ? "w-auto bg-band-low-bg px-2.5 text-band-low"
            : "w-8 text-ink-muted hover:bg-surface-hover hover:text-brand",
        )}
      >
        {state === "transcribing" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : recording ? (
          <>
            {/* A blinking dot and a running clock read as "live" the way a
                camera's REC light does; the square says "this stops it". */}
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-band-low opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-band-low" />
            </span>
            <span className="text-xs font-medium tabular-nums">
              {mm}:{ss}
            </span>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="h-3 w-3">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
          </>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-5 w-5"
          >
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
          </svg>
        )}
      </button>
      {error && <p className="text-xs text-band-low">{error}</p>}
      {notice && !error && <p className="text-xs text-ink-secondary">{notice}</p>}
    </div>
  );
}
