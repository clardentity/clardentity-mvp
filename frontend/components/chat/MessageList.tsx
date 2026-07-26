"use client";

import type { Citation, ChatMessage } from "@/lib/sse";

export type StreamingMessage = {
  mode_used: string;
  content: string;
};

export function MessageList({
  messages,
  streaming,
}: {
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
}) {
  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">
          Pick a mode below and send your first message.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-4 overflow-y-auto px-1 py-4">
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          role={m.role}
          content={m.content ?? ""}
          modeUsed={m.mode_used}
          citations={m.citations}
        />
      ))}
      {streaming && (
        <MessageBubble
          role="assistant"
          content={streaming.content}
          modeUsed={streaming.mode_used}
          citations={[]}
          isStreaming
        />
      )}
    </div>
  );
}

function MessageBubble({
  role,
  content,
  modeUsed,
  citations,
  isStreaming,
}: {
  role: string;
  content: string;
  modeUsed: string;
  citations: Citation[];
  isStreaming?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
          isUser
            ? "bg-brand text-white"
            : "border border-slate-200 bg-white text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-50"
        }`}
      >
        {!isUser && (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {modeUsed}
          </div>
        )}
        <p className="whitespace-pre-wrap">
          {content}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
          )}
        </p>

        {citations.length > 0 && (
          <div className="mt-2 space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Sources
            </p>
            {citations.map((c) => (
              <div key={c.marker} className="text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  [{c.marker}] {c.document_filename}
                </span>
                <p className="line-clamp-2 text-slate-400">{c.excerpt}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
