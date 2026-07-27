"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/apiClient";
import { authErrorMessage, getAccessToken } from "@/lib/auth";
import { streamChatMessage, type ChatMessage } from "@/lib/sse";
import { ModeSelector, type CognitiveMode } from "@/components/chat/ModeSelector";
import {
  ReasoningLensSelector,
  type ReasoningLens,
} from "@/components/chat/ReasoningLensSelector";
import { MessageList, type StreamingMessage } from "@/components/chat/MessageList";
import { MessageInput, type PendingImage } from "@/components/chat/MessageInput";
import {
  AvatarPanel,
  type AvatarExpression,
  type AvatarGesture,
  type AvatarState,
} from "@/components/avatar/AvatarPanel";

type Conversation = {
  id: string;
  title: string | null;
  default_mode: CognitiveMode | null;
};

type AvatarCue = { expression: AvatarExpression; gesture: AvatarGesture };

const GESTURE_BY_MODE: Record<CognitiveMode, AvatarGesture> = {
  knowing: "presenting",
  thinking: "chin_stroke",
  decision: "weighing_scales",
  learning: "open_hand_explaining",
};

export function ChatView({ conversationId }: { conversationId: string }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<CognitiveMode | null>(null);
  const [reasoningLens, setReasoningLens] = useState<ReasoningLens | null>(null);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [avatarCue, setAvatarCue] = useState<AvatarCue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"markdown" | "pdf" | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch<Conversation>(`/chat/conversations/${conversationId}`),
      apiFetch<ChatMessage[]>(`/chat/${conversationId}/messages`),
    ])
      .then(([conv, msgs]) => {
        if (cancelled) return;
        setConversation(conv);
        setMessages(msgs);
        if (conv.default_mode) setMode(conv.default_mode);

        const lastCued = [...msgs].reverse().find((m) => m.avatar_expression && m.avatar_gesture);
        if (lastCued) {
          setAvatarCue({
            expression: lastCued.avatar_expression as AvatarExpression,
            gesture: lastCued.avatar_gesture as AvatarGesture,
          });
        }
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function handleSend(content: string, images: PendingImage[]) {
    if (!mode) return;

    setError(null);
    setSending(true);
    setIsTyping(false);

    const lensForSend = mode === "thinking" ? reasoningLens : null;

    const userMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content,
      mode_used: mode,
      reasoning_lens: lensForSend,
      confidence_score: null,
      confidence_band: null,
      avatar_expression: null,
      avatar_gesture: null,
      created_at: new Date().toISOString(),
      claims: [],
    };
    setMessages((prev) => [...prev, userMessage]);
    setStreaming({ mode_used: mode, content: "" });

    await streamChatMessage(
      conversationId,
      {
        content,
        mode,
        reasoning_lens: lensForSend,
        attachments: images.map((img) => ({
          type: "image",
          data: img.data,
          mime_type: img.mimeType,
        })),
      },
      {
        onDelta: (text) => {
          setStreaming((prev) =>
            prev ? { ...prev, content: prev.content + text } : prev,
          );
        },
        onFinal: (finalEvent) => {
          setMessages((prev) => [...prev, finalEvent.message]);
          setStreaming(null);
          setSending(false);
          if (finalEvent.avatar_cue) {
            setAvatarCue({
              expression: finalEvent.avatar_cue.expression as AvatarExpression,
              gesture: finalEvent.avatar_cue.gesture as AvatarGesture,
            });
          }
          setReacting(true);
          setTimeout(() => setReacting(false), 700);
        },
        onError: (detail) => {
          setError(detail);
          setStreaming(null);
          setSending(false);
        },
      },
    );
  }

  async function handlePlayAudio(messageId: string, text: string) {
    if (playingMessageId === messageId) {
      audioRef.current?.pause();
      setPlayingMessageId(null);
      return;
    }

    setError(null);
    try {
      const accessToken = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/audio/tts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `TTS failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      audioRef.current?.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlayingMessageId(null);
      audio.onerror = () => setPlayingMessageId(null);
      setPlayingMessageId(messageId);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't play audio");
      setPlayingMessageId(null);
    }
  }

  async function handleExport(format: "markdown" | "pdf") {
    setError(null);
    setExporting(format);
    try {
      const accessToken = getAccessToken();
      const res = await fetch(
        `${API_BASE_URL}/chat/${conversationId}/export?format=${format}`,
        {
          headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? `Export failed with status ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const extension = format === "markdown" ? "md" : "pdf";
      const safeTitle = (conversation?.title || "conversation").replace(/[^a-zA-Z0-9-_]/g, "_");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeTitle}.${extension}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't export conversation");
    } finally {
      setExporting(null);
    }
  }

  const avatarState: AvatarState = reacting
    ? "reacting"
    : playingMessageId !== null
      ? "speaking"
      : sending
        ? streaming && streaming.content.length > 0
          ? "speaking"
          : "thinking"
        : isTyping
          ? "listening"
          : "idle";

  const liveGesture: AvatarGesture = mode ? GESTURE_BY_MODE[mode] : "none";
  const avatarGesture: AvatarGesture =
    avatarState === "thinking" || avatarState === "speaking"
      ? liveGesture
      : (avatarCue?.gesture ?? "none");
  const avatarExpression: AvatarExpression =
    avatarState === "reacting" || avatarState === "idle"
      ? (avatarCue?.expression ?? "neutral")
      : "neutral";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{conversation?.title || "Conversation"}</h1>
        <AvatarPanel state={avatarState} gesture={avatarGesture} expression={avatarExpression} />
      </div>

      {messages.length > 0 && (
        <div className="mb-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => handleExport("markdown")}
            disabled={exporting !== null}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand disabled:opacity-50 dark:border-slate-700"
          >
            {exporting === "markdown" ? "Exporting…" : "Export .md"}
          </button>
          <button
            type="button"
            onClick={() => handleExport("pdf")}
            disabled={exporting !== null}
            className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-500 hover:border-brand hover:text-brand disabled:opacity-50 dark:border-slate-700"
          >
            {exporting === "pdf" ? "Exporting…" : "Export .pdf"}
          </button>
        </div>
      )}

      <MessageList
        messages={messages}
        streaming={streaming}
        playingMessageId={playingMessageId}
        onPlayAudio={handlePlayAudio}
      />

      {error && (
        <p className="mb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      <div className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ModeSelector value={mode} onChange={setMode} disabled={sending} />
          {mode === "thinking" && (
            <ReasoningLensSelector
              value={reasoningLens}
              onChange={setReasoningLens}
              disabled={sending}
            />
          )}
        </div>
        <MessageInput
          disabled={!mode || sending}
          disabledReason={
            !mode ? "Select a cognitive mode above to start typing" : undefined
          }
          onSend={handleSend}
          onTypingChange={setIsTyping}
        />
      </div>
    </div>
  );
}
