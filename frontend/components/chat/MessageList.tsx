"use client";

import { useState, type ReactNode } from "react";
import type { Claim, ChatMessage } from "@/lib/sse";
import { ConfidenceBadge } from "@/components/chat/ConfidenceBadge";
import { CitationPopover } from "@/components/chat/CitationPopover";
import { EvidencePanel } from "@/components/chat/EvidencePanel";
import { cx, Spinner } from "@/components/ui/primitives";

export type StreamingMessage = {
  mode_used: string;
  content: string;
};

export function MessageList({
  messages,
  streaming,
  playingMessageId,
  onPlayAudio,
  emptyStateAvatar,
  validatingId,
  onEditMessage,
  onRegenerate,
  busy,
}: {
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
  playingMessageId?: string | null;
  onPlayAudio?: (messageId: string, text: string) => void;
  /** Shown above the empty-state copy. An empty chat is the one moment there
   *  is room for the companion at full size, and the one moment a greeting
   *  from it is worth anything. */
  emptyStateAvatar?: ReactNode;
  /** Answer shown and saved, claims still being checked. */
  validatingId?: string | null;
  onEditMessage?: (messageId: string, content: string) => void;
  onRegenerate?: (messageId: string) => void;
  busy?: boolean;
}) {
  if (messages.length === 0 && !streaming) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
        {emptyStateAvatar}
        <div className="mt-4 max-w-sm text-center">
          <p className="text-sm font-medium text-ink">Start a conversation</p>
          <p className="mt-1 text-sm text-ink-muted">
            Pick a cognitive mode below, then ask your question. Every answer is
            broken into claims, checked against your documents, and screened for
            cognitive bias.
          </p>
        </div>
      </div>
    );
  }

  return (
    // min-h-0 is required for overflow-y-auto to engage: a flex item defaults
    // to min-height:auto, which sizes it to its content and defeats scrolling.
    <div className="scroll-slim min-h-0 flex-1 space-y-5 overflow-y-auto px-1 py-5">
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
          isPlaying={playingMessageId === m.id}
          onPlayAudio={onPlayAudio ? () => onPlayAudio(m.id, m.content ?? "") : undefined}
          isValidating={validatingId === m.id}
          onEdit={
            m.role === "user" && onEditMessage
              ? () => onEditMessage(m.id, m.content ?? "")
              : undefined
          }
          onRegenerate={
            m.role === "assistant" && onRegenerate ? () => onRegenerate(m.id) : undefined
          }
          busy={busy}
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
  isPlaying,
  onPlayAudio,
  isValidating,
  onEdit,
  onRegenerate,
  busy,
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
  isPlaying?: boolean;
  onPlayAudio?: () => void;
  isValidating?: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
  busy?: boolean;
}) {
  const isUser = role === "user";
  const panelId = `evidence-${id}`;
  // Lives here rather than inside EvidencePanel so the confidence badge can
  // open it - clicking a score to find out where it came from should show you
  // the working, not scroll to a collapsed row.
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  return (
    <div className={`group/msg flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            ? "max-w-[78%] rounded-2xl rounded-br-md bg-brand px-4 py-2.5 text-sm leading-relaxed text-white"
            : "w-full max-w-[88%] rounded-2xl rounded-bl-md border border-hairline bg-surface px-4 py-3 text-sm text-ink"
        }
      >
        {!isUser && (
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <span>{modeUsed}</span>
              {reasoningLens && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{reasoningLens.replace("_", "-")}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              {onPlayAudio && content && (
                <button
                  type="button"
                  onClick={onPlayAudio}
                  title={isPlaying ? "Stop playback" : "Listen to this answer"}
                  aria-label={isPlaying ? "Stop playback" : "Listen to this answer"}
                  className="rounded-md p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                  >
                    {isPlaying ? (
                      <>
                        <rect x="6" y="5" width="4" height="14" rx="1" />
                        <rect x="14" y="5" width="4" height="14" rx="1" />
                      </>
                    ) : (
                      <>
                        <path d="M11 5 6 9H2v6h4l5 4z" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                      </>
                    )}
                  </svg>
                </button>
              )}
              {confidenceBand && (
                <ConfidenceBadge
                  band={confidenceBand}
                  score={confidenceScore}
                  onClick={() => {
                    setEvidenceOpen(true);
                    // Next frame, so the panel has rendered its content and
                    // the browser scrolls to its real height.
                    requestAnimationFrame(() =>
                      document
                        .getElementById(panelId)
                        ?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
                    );
                  }}
                />
              )}
            </div>
          </div>
        )}
        <p className="whitespace-pre-wrap leading-relaxed">
          {isUser ? content : renderTextWithCitations(content, claims)}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
          )}
        </p>

        {isValidating && (
          // The answer above is complete and saved. This says what is still
          // happening, so a message that gains a score a few seconds later
          // doesn't look like it changed on its own.
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Spinner className="h-3 w-3" />
            Checking claims against your documents…
          </p>
        )}

        {!isUser && !isStreaming && (
          <EvidencePanel
            claims={claims}
            band={confidenceBand}
            panelId={panelId}
            expanded={evidenceOpen}
            onToggle={() => setEvidenceOpen((v) => !v)}
          />
        )}

        {!isStreaming && (
          <MessageActions
            content={content}
            onEdit={onEdit}
            onRegenerate={onRegenerate}
            busy={busy}
            tone={isUser ? "onBrand" : "default"}
          />
        )}
      </div>
    </div>
  );
}

/** Copy / edit / regenerate. Hidden until the message is hovered or focused
 *  so a conversation doesn't read as rows of buttons, but always reachable by
 *  keyboard. Edit belongs to your messages, regenerate to its answers. */
function MessageActions({
  content,
  onEdit,
  onRegenerate,
  busy,
  tone,
}: {
  content: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
  busy?: boolean;
  tone: "onBrand" | "default";
}) {
  const [copied, setCopied] = useState(false);

  if (!content) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; silently leaving the label unchanged
      // is better than an error toast for something this small.
    }
  }

  const base =
    tone === "onBrand"
      ? "text-white/70 hover:bg-white/15 hover:text-white"
      : "text-ink-muted hover:bg-surface-hover hover:text-ink";

  return (
    <div
      className={cx(
        "mt-2 flex items-center gap-0.5 opacity-0 transition-opacity",
        "group-hover/msg:opacity-100 focus-within:opacity-100",
        tone === "onBrand" && "justify-end",
      )}
    >
      <button
        type="button"
        onClick={copy}
        title={copied ? "Copied" : "Copy"}
        aria-label={copied ? "Copied" : "Copy message"}
        className={cx("rounded-md p-1 transition-colors", base)}
      >
        {copied ? <TickIcon /> : <CopyIcon />}
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          disabled={busy}
          title="Edit and resend"
          aria-label="Edit and resend"
          className={cx("rounded-md p-1 transition-colors disabled:opacity-40", base)}
        >
          <PencilIcon />
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          title="Regenerate this answer"
          aria-label="Regenerate this answer"
          className={cx("rounded-md p-1 transition-colors disabled:opacity-40", base)}
        >
          <RedoIcon />
        </button>
      )}
    </div>
  );
}

function ActionIcon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      {children}
    </svg>
  );
}

const CopyIcon = () => (
  <ActionIcon>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </ActionIcon>
);

const TickIcon = () => (
  <ActionIcon>
    <path d="m5 13 4 4L19 7" />
  </ActionIcon>
);

const PencilIcon = () => (
  <ActionIcon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </ActionIcon>
);

const RedoIcon = () => (
  <ActionIcon>
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 4v5h-5" />
  </ActionIcon>
);
