"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Claim,
  ChatMessage,
  Evidence,
  Guidance,
  DecisionReviewData,
  ThinkingReviewData,
} from "@/lib/sse";
import { ConfidenceBadge } from "@/components/chat/ConfidenceBadge";
import { CruxCard } from "@/components/chat/CruxCard";
import { CitationPopover } from "@/components/chat/CitationPopover";
import { OpinionMarker } from "@/components/chat/OpinionMarker";
import { ResponseFlip, FlipButton, useCounterfactual } from "@/components/chat/ResponseFlip";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { ClarifierCard } from "@/components/chat/ClarifierCard";
import { GuidanceCard } from "@/components/chat/GuidanceCard";
import { DecisionReview } from "@/components/chat/DecisionReview";
import { ThinkingReview } from "@/components/chat/ThinkingReview";
import { FeedbackWidget } from "@/components/chat/FeedbackWidget";
import { ExportFileMenu } from "@/components/chat/ExportFileMenu";
import { cleanMessageText } from "@/lib/text";
import { cx, Spinner } from "@/components/ui/primitives";

export type StreamingMessage = {
  mode_used: string;
  content: string;
  /** Arrives before any body text (its own SSE event), so the gist is the
   *  first thing on screen and the body streams in behind the fold. */
  crux?: string | null;
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
  onDeleteMessage,
  onSwitchBranch,
  busy,
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
  /** Permanently deletes this message and everything after it, so the
   *  conversation can continue fresh from here. Offered on both roles. */
  onDeleteMessage?: (messageId: string) => void;
  /** Fork switcher: move to the branch that starts with this sibling id. */
  onSwitchBranch?: (messageId: string) => void;
  busy?: boolean;
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
          crux={m.crux_text}
          createdAt={m.created_at}
          counterfactual={m.counterfactual_content}
          clarifier={m.clarifier}
          guidance={m.guidance}
          decisionReview={m.decision_review}
          thinkingReview={m.thinking_review}
          feedback={m.feedback}
          siblingIndex={m.sibling_index}
          siblingCount={m.sibling_count}
          siblingIds={m.sibling_ids}
          onSwitchBranch={onSwitchBranch}
          isPlaying={playingMessageId === m.id}
          onPlayAudio={onPlayAudio ? () => onPlayAudio(m.id, m.content ?? "") : undefined}
          isValidating={validatingId === m.id}
          canEdit={m.role === "user" && Boolean(onSubmitEdit)}
          onRegenerate={
            m.role === "assistant" && onRegenerate ? () => onRegenerate(m.id) : undefined
          }
          onDelete={onDeleteMessage ? () => onDeleteMessage(m.id) : undefined}
          busy={busy}
          conversationId={conversationId}
          onClarifierAnswer={onClarifierAnswer}
          onUseMode={onUseMode}
          onAskRefined={onAskRefined}
          onSubmitEdit={onSubmitEdit}
        />
      ))}
      {/* Generation happens under the hood. Until the gist lands, the whole
          wait is the rabbit; the body text that streams in meanwhile is
          accumulated (so cancelling mid-way still has it) but never shown
          token by token - the finished answer replaces this all at once. */}
      {busy && !streaming?.crux && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-bl-md border border-hairline bg-surface px-4 py-3">
            <ThinkingIndicator />
          </div>
        </div>
      )}
      {/* The bubble appears as soon as there is a gist to show - the gist is
          the first thing read, and the rest is still being written behind
          it (the rabbit says so, under the card). */}
      {streaming?.crux && (
        <MessageBubble
          id="streaming"
          role="assistant"
          content={streaming.content}
          modeUsed={streaming.mode_used}
          confidenceScore={null}
          confidenceBand={null}
          claims={[]}
          crux={streaming.crux ?? null}
          isStreaming
        />
      )}
    </div>
  );
}

/** "10:04" for anything from today, "8 Sept, 10:04" otherwise. Conversations
 *  here run across days, and a bare time on a message from last week read as
 *  if it were from today - the date is only dropped when it would be
 *  redundant. Same shape as WorkspaceDetail's shortDate for older rows. */
function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return time;
  const date = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${date}, ${time}`;
}

/** The tier (`entailment_label`) and score belong to the CLAIM the marker's
 *  evidence sits inside, not to the evidence item itself - a claim can cite
 *  several sources, and the tier is a verdict on the claim as a whole. */
function findEvidenceForMarker(
  claims: Claim[],
  marker: number,
): { evidence: Evidence; claimScore: number | null; entailmentLabel: string | null } | null {
  for (const claim of claims) {
    const found = claim.evidence.find((e) => e.citation_marker === marker);
    if (found) {
      return { evidence: found, claimScore: claim.claim_score, entailmentLabel: claim.entailment_label };
    }
  }
  return null;
}

function renderCitations(text: string, claims: Claim[], keyPrefix: string): ReactNode[] {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <span key={`${keyPrefix}-${i}`}>{part}</span>;
    const marker = parseInt(match[1], 10);
    const found = findEvidenceForMarker(claims, marker);
    return (
      <CitationPopover
        key={`${keyPrefix}-${i}`}
        marker={marker}
        evidence={found?.evidence ?? null}
        claimScore={found?.claimScore ?? null}
        entailmentLabel={found?.entailmentLabel ?? null}
      />
    );
  });
}

/** Citation markers become popovers; sentences the model tagged as its own
 *  opinion get an inline "opinion" tag after them. Opinions have no citation
 *  by definition, so this tag is the only thing that distinguishes them from
 *  sourced text now that the evidence panel is gone. Located by matching the
 *  claim's text inside the prose - the claim text is lifted from that same
 *  prose, so an exact match is the normal case; a claim that doesn't match
 *  (reflection reworded it) simply goes untagged rather than mis-tagged. */
function renderTextWithCitations(text: string, claims: Claim[]): ReactNode[] {
  // Messages written before the backend stripped markup still have it stored.
  const clean = cleanMessageText(text);
  const cuts: number[] = [];
  for (const claim of claims) {
    if (claim.entailment_label !== "opinion") continue;
    const needle = cleanMessageText(claim.claim_text).trim();
    if (needle.length < 8) continue;
    const at = clean.indexOf(needle);
    if (at !== -1) cuts.push(at + needle.length);
  }
  if (cuts.length === 0) return renderCitations(clean, claims, "t");

  const out: ReactNode[] = [];
  let from = 0;
  for (const [n, cut] of [...new Set(cuts)].sort((a, b) => a - b).entries()) {
    out.push(...renderCitations(clean.slice(from, cut), claims, `s${n}`));
    out.push(<OpinionMarker key={`op${n}`} />);
    from = cut;
  }
  out.push(...renderCitations(clean.slice(from), claims, "tail"));
  return out;
}

/* A user message can carry one or more pre-answer exchanges inside it: the
 * composer embeds each gate Clardentity raised (a context question, a
 * "did you mean", a clarifying choice) as
 *   <original>\n\n(Clardentity asked: "<question>")\n<answer>
 * so the whole turn is one message for the model and for edit/resend. That
 * raw form is kept for both; only the rendering unpicks it, into the original
 * question followed by a small two-sided thread - Clardentity's question on
 * the left, the reply on the right - the way a quoted exchange reads in a
 * messaging app. */
const ASKED_RE = /\n\n\(Clardentity asked: "([\s\S]*?)"\)\n/g;

type Exchange = { question: string; answer: string };

function parseUserMessage(content: string): { head: string; exchanges: Exchange[] } {
  const exchanges: Exchange[] = [];
  let head = content;
  let match: RegExpExecArray | null;
  let cursor = 0;
  let pendingQuestion: string | null = null;
  ASKED_RE.lastIndex = 0;
  while ((match = ASKED_RE.exec(content)) !== null) {
    const before = content.slice(cursor, match.index);
    if (pendingQuestion === null) head = before;
    else exchanges.push({ question: pendingQuestion, answer: before.trim() });
    pendingQuestion = match[1];
    cursor = match.index + match[0].length;
  }
  if (pendingQuestion !== null) {
    exchanges.push({ question: pendingQuestion, answer: content.slice(cursor).trim() });
  }
  return { head, exchanges };
}

function UserMessageBody({ content }: { content: string }) {
  const { head, exchanges } = parseUserMessage(content);
  if (exchanges.length === 0) {
    return <p className="whitespace-pre-wrap leading-relaxed">{content}</p>;
  }
  return (
    <div>
      <p className="whitespace-pre-wrap leading-relaxed">{head}</p>
      <div className="mt-2 space-y-1.5 rounded-xl bg-black/15 p-1.5">
        {exchanges.map((x, i) => (
          <div key={i} className="space-y-1.5">
            <div className="flex justify-start">
              <div className="max-w-[88%] rounded-xl rounded-bl-sm bg-white/15 px-2.5 py-1.5 text-[13px] leading-snug">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-white/70">
                  Clardentity
                </span>
                <span className="whitespace-pre-wrap">{x.question}</span>
              </div>
            </div>
            {x.answer && (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-xl rounded-br-sm bg-white px-2.5 py-1.5 text-[13px] leading-snug text-brand">
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-brand/70">
                    You
                  </span>
                  <span className="whitespace-pre-wrap">{x.answer}</span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  id,
  role,
  content,
  modeUsed,
  confidenceScore,
  confidenceBand,
  claims,
  crux,
  createdAt,
  counterfactual,
  clarifier,
  guidance,
  decisionReview,
  thinkingReview,
  feedback,
  siblingIndex,
  siblingCount,
  siblingIds,
  onSwitchBranch,
  isStreaming,
  isPlaying,
  onPlayAudio,
  isValidating,
  canEdit,
  onRegenerate,
  onDelete,
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
  /** The model's own one-sentence bottom line. Null for messages generated
   *  before this shipped, and always absent while still streaming. */
  crux?: string | null;
  /** Absent for the synthetic streaming bubble, which isn't a real message
   *  yet - it gets a real one once `onAnswer` replaces it. */
  createdAt?: string;
  counterfactual?: string | null;
  clarifier?: { question: string; options: string[] } | null;
  guidance?: Guidance | null;
  decisionReview?: DecisionReviewData | null;
  thinkingReview?: ThinkingReviewData | null;
  feedback?: { rating: "up" | "down" | null; comment: string | null } | null;
  /** This message's position among its siblings, and how many there are -
   *  1 sibling means there's nothing to switch between. */
  siblingIndex?: number;
  siblingCount?: number;
  siblingIds?: string[];
  onSwitchBranch?: (messageId: string) => void;
  isStreaming?: boolean;
  isPlaying?: boolean;
  onPlayAudio?: () => void;
  isValidating?: boolean;
  canEdit?: boolean;
  onRegenerate?: () => void;
  /** Permanently deletes this message and everything after it. */
  onDelete?: () => void;
  busy?: boolean;
  conversationId?: string;
  onClarifierAnswer?: (answer: string) => void;
  onUseMode?: (mode: string) => void;
  onAskRefined?: (question: string) => void;
  onSubmitEdit?: (messageId: string, content: string) => void;
}) {
  const isUser = role === "user";

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
  // Whether the crux exists at all decides whether there's a fold in the
  // first place - a message with no crux (written before this shipped, or a
  // stream whose gist hasn't landed yet) just renders the answer flat. While
  // streaming, the gist arrives as its own event before any body text, so
  // the fold exists from the first token: the body writes itself in behind
  // it rather than scrolling past the reader first.
  const hasCrux = !isUser && Boolean(crux);
  // Collapsed by default, even the first time this message is seen: the
  // whole point of the crux is to make reading the full answer optional,
  // not to show it in full anyway and add a summary on top.
  const [detailOpen, setDetailOpen] = useState(false);
  // Named for what's actually behind the fold in Thinking/Decision mode -
  // the box above it already carries the verdict, so what's hidden is the
  // reasoning trail that produced it, not "the answer" (the box already is
  // one). Other modes keep the generic wording, since there's no separate
  // verdict box for the fold to be "more detail than".
  const detailLabels =
    panel === "thinking"
      ? { show: "Details of thinking journey", hide: "Hide details of thinking journey" }
      : panel === "decision"
        ? {
            show: "Details of the decision making journey",
            hide: "Hide details of the decision making journey",
          }
        : { show: "Show full answer", hide: "Hide full answer" };
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
                <ConfidenceBadge band={confidenceBand} score={confidenceScore} />
              )}
            </div>
          </div>
        )}
        {guidance && !isStreaming && (
          // Above the answer, not below it: this is a nudge about the
          // *question* ("did you mean...", "this fits a different mode
          // better") - the same place a search engine puts "Did you mean?",
          // since it's read before the answer it would have changed, not as
          // a footnote after.
          <GuidanceCard
            guidance={guidance}
            onUseMode={onUseMode ? (m) => onUseMode(m) : undefined}
            onAskRefined={onAskRefined}
            disabled={busy}
          />
        )}
        {hasCrux && <CruxCard text={crux as string} />}
        {/* The reasoning-contrast / decision-verdict box is the analysis
            itself, not detail to hide behind a click - it stays outside the
            fold and always leads, with the raw paragraph text (which only
            elaborates on it) tucked behind a mode-named expand toggle below. */}
        {!isUser && !isStreaming && panel === "thinking" && thinkingReview && (
          <ThinkingReview review={thinkingReview} />
        )}
        {!isUser && !isStreaming && panel === "decision" && decisionReview && (
          <DecisionReview review={decisionReview} />
        )}
        {hasCrux && isStreaming && (
          // The rest is still being written, out of sight. No fold yet -
          // there's nothing finished behind it to open.
          <ThinkingIndicator compact />
        )}
        {hasCrux && !isStreaming && (
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
            className="group -mx-1 mb-1.5 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-secondary"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={cx("h-3 w-3 shrink-0 transition-transform", detailOpen && "rotate-90")}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
            {detailOpen ? detailLabels.hide : detailLabels.show}
          </button>
        )}
        {!isStreaming && (!hasCrux || detailOpen) && (
        <>
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
          <UserMessageBody content={content} />
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
        </>
        )}

        {clarifier && !isStreaming && onClarifierAnswer && (
          <ClarifierCard
            question={clarifier.question}
            options={clarifier.options}
            onAnswer={onClarifierAnswer}
            disabled={busy}
          />
        )}

        {!isUser && !isStreaming && conversationId && (
          <FeedbackWidget conversationId={conversationId} messageId={id} feedback={feedback ?? null} />
        )}

        {!isUser && !isStreaming && conversationId && modeUsed === "creative" && (
          <ExportFileMenu conversationId={conversationId} messageId={id} />
        )}

        {!isStreaming && (siblingCount ?? 1) > 1 && siblingIds && onSwitchBranch && (
          <ForkSwitcher
            siblingIds={siblingIds}
            siblingIndex={siblingIndex ?? 0}
            onSwitchBranch={onSwitchBranch}
            tone={isUser ? "onBrand" : "default"}
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
            onDelete={onDelete}
            busy={busy}
            tone={isUser ? "onBrand" : "default"}
          />
        )}
        {!isStreaming && createdAt && (
          // Its own row, not folded into MessageActions: that row hides
          // itself until hovered on a user bubble, and a timestamp you have
          // to hover to see isn't one you can glance at.
          <time
            dateTime={createdAt}
            className={cx(
              "mt-1 block text-[10px] tabular-nums",
              isUser ? "text-right text-white/50" : "text-ink-muted",
            )}
          >
            {formatMessageTime(createdAt)}
          </time>
        )}
      </div>
    </div>
  );
}

/** "< 2/3 >" - move between sibling versions of this exact message: other
 *  answers to the same question (regenerate), or other wordings of the
 *  question itself (edit). Always visible once there's more than one, the
 *  same way a chat client's own version switcher never hides - it's the only
 *  way back to something regenerating or editing would otherwise bury. */
function ForkSwitcher({
  siblingIds,
  siblingIndex,
  onSwitchBranch,
  tone,
}: {
  siblingIds: string[];
  siblingIndex: number;
  onSwitchBranch: (messageId: string) => void;
  tone: "onBrand" | "default";
}) {
  const count = siblingIds.length;
  const base =
    tone === "onBrand"
      ? "text-white/70 hover:bg-white/15 hover:text-white"
      : "text-ink-muted hover:bg-surface-hover hover:text-ink";

  return (
    <div
      className={cx(
        "mt-1.5 flex items-center gap-0.5 text-[11px] text-ink-muted",
        tone === "onBrand" && "justify-end",
      )}
    >
      <button
        type="button"
        onClick={() => onSwitchBranch(siblingIds[siblingIndex - 1])}
        disabled={siblingIndex <= 0}
        aria-label="Previous version"
        className={cx("rounded-md p-0.5 transition-colors disabled:opacity-30", base)}
      >
        <ChevronIcon direction="left" />
      </button>
      <span className="tabular-nums">
        {siblingIndex + 1}/{count}
      </span>
      <button
        type="button"
        onClick={() => onSwitchBranch(siblingIds[siblingIndex + 1])}
        disabled={siblingIndex >= count - 1}
        aria-label="Next version"
        className={cx("rounded-md p-0.5 transition-colors disabled:opacity-30", base)}
      >
        <ChevronIcon direction="right" />
      </button>
    </div>
  );
}

const ChevronIcon = ({ direction }: { direction: "left" | "right" }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="h-3 w-3"
  >
    <path d={direction === "left" ? "m15 18-6-6 6-6" : "m9 6 6 6-6 6"} />
  </svg>
);

/** Copy / edit / regenerate. Hidden until the message is hovered or focused
 *  so a conversation doesn't read as rows of buttons, but always reachable by
 *  keyboard. Edit belongs to your messages, regenerate to its answers. */
function MessageActions({
  content,
  onEdit,
  onRegenerate,
  onDelete,
  busy,
  tone,
}: {
  content: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  busy?: boolean;
  tone: "onBrand" | "default";
}) {
  const [copied, setCopied] = useState(false);
  // Two clicks, not a browser confirm() - same pattern the sidebar's own
  // chat-delete button already uses. autoFocus + onBlur means walking away
  // cancels it as surely as clicking elsewhere would.
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
      {onDelete && (
        confirmingDelete ? (
          <button
            type="button"
            onClick={() => {
              setConfirmingDelete(false);
              onDelete();
            }}
            onBlur={() => setConfirmingDelete(false)}
            autoFocus
            disabled={busy}
            className={cx(
              "rounded-md px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40",
              tone === "onBrand" ? "text-white" : "text-band-low",
            )}
          >
            Sure?
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={busy}
            title="Delete this message and everything after it"
            aria-label="Delete this message and everything after it"
            className={cx("rounded-md p-1 transition-colors disabled:opacity-40", base)}
          >
            <TrashIcon />
          </button>
        )
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

const TrashIcon = () => (
  <ActionIcon>
    <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </ActionIcon>
);
