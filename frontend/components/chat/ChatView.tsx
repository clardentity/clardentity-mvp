"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { streamChatMessage, type ChatMessage } from "@/lib/sse";
import { ModeSelector, type CognitiveMode } from "@/components/chat/ModeSelector";
import {
  ReasoningLensSelector,
  type ReasoningLens,
} from "@/components/chat/ReasoningLensSelector";
import { MessageList, type StreamingMessage } from "@/components/chat/MessageList";
import { MessageInput } from "@/components/chat/MessageInput";

type Conversation = {
  id: string;
  title: string | null;
  default_mode: CognitiveMode | null;
};

export function ChatView({ conversationId }: { conversationId: string }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<CognitiveMode | null>(null);
  const [reasoningLens, setReasoningLens] = useState<ReasoningLens | null>(null);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function handleSend(content: string) {
    if (!mode) return;

    setError(null);
    setSending(true);

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
      { content, mode, reasoning_lens: lensForSend },
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
        },
        onError: (detail) => {
          setError(detail);
          setStreaming(null);
          setSending(false);
        },
      },
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
      <h1 className="mb-4 text-lg font-semibold">
        {conversation?.title || "Conversation"}
      </h1>

      <MessageList messages={messages} streaming={streaming} />

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
        />
      </div>
    </div>
  );
}
