"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Claim,
  ChatMessage,
  Guidance,
  DecisionReviewData,
  ThinkingReviewData,
} from "@/lib/sse";
import { ConfidenceBadge } from "@/components/chat/ConfidenceBadge";
import { CitationPopover } from "@/components/chat/CitationPopover";
import { EvidencePanel } from "@/components/chat/EvidencePanel";
import { ResponseFlip, FlipButton, useCounterfactual } from "@/components/chat/ResponseFlip";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { ClarifierCard } from "@/components/chat/ClarifierCard";
import { GuidanceCard } from "@/components/chat/GuidanceCard";
import { DecisionReview } from "@/components/chat/DecisionReview";
import { ThinkingReview } from "@/components/chat/ThinkingReview";
import { cleanMessageText } from "@/lib/text";
import { cx, Spinner } from "@/components/ui/primitives";

export type StreamingMessage = {
  mode_used: string;
  content: string;
};

export function MessageList({
  conversationId,
  messages,
  streaming,
  playingMessageId,
  onPlayAudio,
  emptyStateAvatar,
  validatingId,
  onRegenerate,
  busy,
  statusLabel,
  onClarifierAnswer,
  onUseMode,
  onAskRefined,
  loading,
  onSubmitEdit,
}: {
  conversationId: string;
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
  onRegenerate?: (messageId: string) => void;
  busy?: boolean;
  /** Shown while a request is in flight and no tokens have arrived yet. */
  statusLabel?: string | null;
  /** Sends a clarifying-question answer as the next message. */
  onClarifierAnswer?: (answer: string) => void;
  /** Acting on a guidance nudge: switch mode, or ask the sharper question. */
  onUseMode?: (mode: string) => void;
  onAskRefined?: (question: string) => void;
  /** History is still being fetched. Distinct from "there is nothing here" -
   *  showing the empty state first made every reopened chat flash
   *  "Start a chat" before its messages arrived. */
  loading?: boolean;
  onSubmitEdit?: (messageId: string, content: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /* Whether to follow new content down.
   *
   * True until you scroll away from the bottom yourself. Without this, reading
   * back through an answer while the next one streams in yanks you to the
   * bottom every few hundred milliseconds - the one thing worse than not
   * scrolling at all. A ref rather than state: it changes on every scroll
   * event and nothing renders from it. */
  const stickToBottom = useRef(true);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    // 80px of slack, so "near enough the bottom" survives the last line of a
    // message and a rounding error.
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  const lastMessageId = messages.at(-1)?.id ?? null;

  // A new message - yours or its answer - is the moment you want to be at the
  // bottom, so this one is smooth and deliberate.
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [lastMessageId, busy]);

  // Streaming text arrives many times a second; smooth scrolling that would
  // queue an animation per token and visibly lag the text.
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [streaming?.content]);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
        {emptyStateAvatar}
        <div className="mt-4">
          <ThinkingIndicator label="Opening the chat" />
        </div>
      </div>
    );
  }

  if (messages.length === 0 && !streaming && !busy) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 sm:px-6">
        {emptyStateAvatar}
        <div className="mt-4 max-w-sm text-center">
          <p className="text-sm font-medium text-ink">Start a chat</p>
          <p className="mt-1 text-sm text-ink-muted">
            Pick a cognitive mode below, then ask your question. Every answer is
            broken into claims and checked against its sources, so you can see
            what each part of it rests on.
          </p>
        </div>
      </div>
    );
  }

  return (
    // min-h-0 is required for overflow-y-auto to engage: a flex item defaults
    // to min-height:auto, which sizes it to its content and defeats scrolling.
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="scroll-slim min-h-0 flex-1 animate-[fade-in_0.35s_ease] space-y-5 overflow-y-auto px-1 py-5"
    >
      {messages.map((m) => (
        <MessageBubble
          key={m.id}
          id={m.id}
          role={m.role}
          content={m.content ?? ""}
          modeUsed={m.mode_used}
          confidenceScore={m.confidence_score}
          confidenceBand={m.confidence_band}
          claims={m.claims}
          counterfactual={m.counterfactual_content}
          clarifier={m.clarifier}
          guidance={m.guidance}
          decisionReview={m.decision_review}
          thinkingReview={m.thinking_review}
          isPlaying={playingMessageId === m.id}
          onPlayAudio={onPlayAudio ? () => onPlayAudio(m.id, m.content ?? "") : undefined}
          isValidating={validatingId === m.id}
          canEdit={m.role === "user" && Boolean(onSubmitEdit)}
          onRegenerate={
            m.role === "assistant" && onRegenerate ? () => onRegenerate(m.id) : undefined
          }
          busy={busy}
          conversationId={conversationId}
          onClarifierAnswer={onClarifierAnswer}
          onUseMode={onUseMode}
          onAskRefined={onAskRefined}
          onSubmitEdit={onSubmitEdit}
        />
      ))}
      {/* `streaming` is set the instant a send starts, with empty content, so
          the old `!streaming` here was never true and this never rendered -
          you got an empty bubble for the whole wait instead. What matters is
          whether any text has arrived, not whether a stream object exists. */}
      {busy && !streaming?.content && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-bl-md border border-hairline bg-surface px-4 py-3">
            <ThinkingIndicator label={statusLabel} />
          </div>
        </div>
      )}
      {streaming?.content && (
        <MessageBubble
          id="streaming"
          role="assistant"
          content={streaming.content}
          modeUsed={streaming.mode_used}
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
  // Messages written before the backend stripped markup still have it stored.
  const parts = cleanMessageText(text).split(/(\[\d+\])/g);
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
  confidenceScore,
  confidenceBand,
  claims,
  counterfactual,
  clarifier,
  guidance,
  decisionReview,
  thinkingReview,
  isStreaming,
  isPlaying,
  onPlayAudio,
  isValidating,
  canEdit,
  onRegenerate,
  busy,
  conversationId,
  onClarifierAnswer,
  onUseMode,
  onAskRefined,
  onSubmitEdit,
}: {
  id: string;
  role: string;
  content: string;
  modeUsed: string;
  confidenceScore: number | null;
  confidenceBand: string | null;
  claims: Claim[];
  counterfactual?: string | null;
  clarifier?: { question: string; options: string[] } | null;
  guidance?: Guidance | null;
  decisionReview?: DecisionReviewData | null;
  thinkingReview?: ThinkingReviewData | null;
  isStreaming?: boolean;
  isPlaying?: boolean;
  onPlayAudio?: () => void;
  isValidating?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  busy?: boolean;
  conversationId?: string;
  onClarifierAnswer?: (answer: string) => void;
  onUseMode?: (mode: string) => void;
  onAskRefined?: (question: string) => void;
  onSubmitEdit?: (messageId: string, content: string) => void;
}) {
  const isUser = role === "user";
  const panelId = `evidence-${id}`;

  /* Whether a confidence verdict is meaningful for this answer.
   *
   * The band measures how well claims are grounded in cited sources. In
   * Knowing that is the entire job, so it is always shown - including when
   * nothing supported the answer, which is exactly when the reader most needs
   * telling.
   *
   * The other three modes produce reasoning, recommendations and
   * explanations. A Thinking answer with nothing cited is not dubious, it is
   * a chain of reasoning, and stamping "Needs Verification" on it reports an
   * absence that was never a fault - the same category error as calling an
   * uncited claim "Fabricated". So outside Knowing the verdict appears only
   * once the answer actually rested on a source, where it is a real
   * statement about real evidence. */
  const citedAnything = claims.some((c) => c.evidence.length > 0);

  /* Which panel belongs under this answer.
   *
   * Thinking and Decision don't produce claims worth citing. A reasoning
   * chain is sound or unsound, not sourced or unsourced; a recommendation is
   * a judgement, not a fact with a footnote. Showing them an evidence panel
   * reported an absence that was never a fault, so each gets the panel that
   * actually says something about its own output - the reasoning contrast,
   * and the decisions worth considering. Knowing and Learning keep the
   * evidence, which is the whole point of those two. */
  const panel =
    modeUsed === "thinking" ? "thinking" : modeUsed === "decision" ? "decision" : "evidence";
  const verdictIsMeaningful =
    panel === "evidence" && (modeUsed === "knowing" || citedAnything);
  // Lives here rather than inside EvidencePanel so the confidence badge can
  // open it - clicking a score to find out where it came from should show you
  // the working, not scroll to a collapsed row.
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // The Devil's Draft now lives on the back of this bubble rather than in a
  // panel beneath it, so its state belongs to the bubble.
  const devil = useCounterfactual({ conversationId, messageId: id, preloaded: counterfactual });
  // Editing happens inside the bubble. The previous version rewound the
  // conversation the moment you clicked edit and dropped the text into the
  // composer - so the rest of the chat disappeared before you had typed
  // anything, and cancelling was impossible because it was already gone.
  // Nothing is destroyed now until you actually submit.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

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
            {/* Mode only. The reasoning lens the agent picked is deliberately
                never surfaced - it is an internal choice about how to think,
                and naming it ("critical", "non-linear") asked the reader to
                hold a vocabulary that was only ever meant for the model. */}
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <span>{modeUsed}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {!isStreaming && content && (
                <FlipButton flipped={devil.flipped} onClick={devil.toggle} />
              )}
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
              {confidenceBand && verdictIsMeaningful && (
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
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const trimmed = draft.trim();
              if (!trimmed || trimmed === content) {
                setEditing(false);
                return;
              }
              setEditing(false);
              onSubmitEdit?.(id, trimmed);
            }}
          >
            <textarea
              value={draft}
              autoFocus
              rows={Math.min(8, draft.split("\n").length + 1)}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setDraft(content);
                  setEditing(false);
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              className="w-full resize-none rounded-lg bg-black/15 px-2 py-1.5 text-sm leading-relaxed text-white outline-none ring-1 ring-white/25 focus:ring-white/50"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2 text-[11px]">
              <span className="mr-auto text-white/60">Enter to resend, Esc to cancel</span>
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setEditing(false);
                }}
                className="rounded-md px-2 py-0.5 text-white/80 transition-colors hover:bg-white/15"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-white/20 px-2 py-0.5 font-medium text-white transition-colors hover:bg-white/30"
              >
                Resend
              </button>
            </div>
          </form>
        ) : isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{content}</p>
        ) : (
          // Only answers have a back. Wrapping your own messages in the flip
          // container gave them a second face they could never show, and the
          // stacked grid sized every user bubble to it.
          <ResponseFlip
            flipped={devil.flipped}
            text={devil.text}
            loading={devil.loading}
            error={devil.error}
            front={
              <p className="whitespace-pre-wrap leading-relaxed">
                {renderTextWithCitations(content, claims)}
                {isStreaming && (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
                )}
              </p>
            }
          />
        )}

        {isValidating && (
          // The answer above is complete and saved. This says what is still
          // happening, so a message that gains a score a few seconds later
          // doesn't look like it changed on its own.
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Spinner className="h-3 w-3" />
            Checking claims…
          </p>
        )}

        {!isUser && !isStreaming && panel === "thinking" && thinkingReview && (
          <ThinkingReview review={thinkingReview} />
        )}

        {!isUser && !isStreaming && verdictIsMeaningful && (
          <EvidencePanel
            claims={claims}
            band={confidenceBand}
            panelId={panelId}
            expanded={evidenceOpen}
            onToggle={() => setEvidenceOpen((v) => !v)}
          />
        )}

        {clarifier && !isStreaming && onClarifierAnswer && (
          <ClarifierCard
            question={clarifier.question}
            options={clarifier.options}
            onAnswer={onClarifierAnswer}
            disabled={busy}
          />
        )}

        {panel === "decision" && decisionReview && !isStreaming && (
          <DecisionReview review={decisionReview} />
        )}

        {guidance && !isStreaming && (
          <GuidanceCard
            guidance={guidance}
            onUseMode={onUseMode ? (m) => onUseMode(m) : undefined}
            onAskRefined={onAskRefined}
            disabled={busy}
          />
        )}

        {!isStreaming && !editing && (
          <MessageActions
            content={content}
            onEdit={
              canEdit
                ? () => {
                    setDraft(content);
                    setEditing(true);
                  }
                : undefined
            }
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
      // What was on screen, not what was on the wire. Citation markers point
      // at a numbered source list that isn't coming with the text, so they
      // paste as meaningless "[2]"s into whatever the reader is writing.
      const plain = cleanMessageText(content).replace(/\s*\[\d+\]/g, "");
      await navigator.clipboard.writeText(plain);
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
        "mt-2 flex items-center gap-0.5 transition-opacity",
        "group-hover/msg:opacity-100 focus-within:opacity-100",
        // An answer's actions stay visible. Hover-only was fine for your own
        // messages - short, and you know what you wrote - but on a response
        // it put Copy behind a hover, below the evidence panel, where nobody
        // found it. On the brand bubble a permanent row is just noise.
        tone === "onBrand" ? "justify-end opacity-0" : "opacity-45",
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
