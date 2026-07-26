"use client";

import type { ReactNode } from "react";
import type { Claim, ChatMessage } from "@/lib/sse";
import { ConfidenceBadge } from "@/components/chat/ConfidenceBadge";
import { CitationPopover } from "@/components/chat/CitationPopover";
import { EvidencePanel } from "@/components/chat/EvidencePanel";

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
          id={m.id}
          role={m.role}
          content={m.content ?? ""}
          modeUsed={m.mode_used}
          reasoningLens={m.reasoning_lens}
          confidenceScore={m.confidence_score}
          confidenceBand={m.confidence_band}
          claims={m.claims}
        />
      ))}
      {streaming && (
        <MessageBubble
          id="streaming"
          role="assistant"
          content={streaming.content}
          modeUsed={streaming.mode_used}
          reasoningLens={null}
          confidenceScore={null}
          confidenceBand={null}
          claims={[]}
          isStreaming
        />
      )}
    </div>
  );
}

function findEvidenceForMarker(claims: Claim[], marker: number) {
  for (const claim of claims) {
    const found = claim.evidence.find((e) => e.citation_marker === marker);
    if (found) return found;
  }
  return null;
}

function renderTextWithCitations(text: string, claims: Claim[]): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <span key={i}>{part}</span>;
    const marker = parseInt(match[1], 10);
    return (
      <CitationPopover key={i} marker={marker} evidence={findEvidenceForMarker(claims, marker)} />
    );
  });
}

function MessageBubble({
  id,
  role,
  content,
  modeUsed,
  reasoningLens,
  confidenceScore,
  confidenceBand,
  claims,
  isStreaming,
}: {
  id: string;
  role: string;
  content: string;
  modeUsed: string;
  reasoningLens: string | null;
  confidenceScore: number | null;
  confidenceBand: string | null;
  claims: Claim[];
  isStreaming?: boolean;
}) {
  const isUser = role === "user";
  const panelId = `evidence-${id}`;

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
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {modeUsed}
              {reasoningLens && ` · ${reasoningLens.replace("_", "-")}`}
            </div>
            {confidenceBand && (
              <ConfidenceBadge
                band={confidenceBand}
                score={confidenceScore}
                onClick={() => document.getElementById(panelId)?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
              />
            )}
          </div>
        )}
        <p className="whitespace-pre-wrap">
          {isUser ? content : renderTextWithCitations(content, claims)}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
          )}
        </p>

        {!isUser && <EvidencePanel claims={claims} band={confidenceBand} panelId={panelId} />}
      </div>
    </div>
  );
}
