"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ErrorBoundary } from "@/components/system/ErrorBoundaries";
import { usePhoneLayout } from "@/lib/usePhoneLayout";
import type {
  Claim,
  ChatMessage,
  Evidence,
  Guidance,
  DecisionReviewData,
  GeneratedImage,
  ThinkingReviewData,
} from "@/lib/sse";
import { ConfidenceBadge } from "@/components/chat/ConfidenceBadge";
import { CruxCard } from "@/components/chat/CruxCard";
import { modeLabel } from "@/lib/modes";
import { SourcesFooter } from "@/components/chat/SourcesFooter";
import { CitationPopover } from "@/components/chat/CitationPopover";
import { OpinionMarker } from "@/components/chat/OpinionMarker";
import { ResponseFlip, FlipButton, useCounterfactual } from "@/components/chat/ResponseFlip";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import { ClarifierCard } from "@/components/chat/ClarifierCard";
import { GuidanceCard } from "@/components/chat/GuidanceCard";
import { DecisionReview } from "@/components/chat/DecisionReview";
import {
  GeneratedImageCard,
  GeneratedImagePlaceholder,
} from "@/components/chat/GeneratedImageCard";
import { ThinkingReview } from "@/components/chat/ThinkingReview";
import { FeedbackWidget } from "@/components/chat/FeedbackWidget";
import { ExportFileMenu } from "@/components/chat/ExportFileMenu";
import { cleanMessageText } from "@/lib/text";
import { renderInline, splitBlocks } from "@/lib/markdown";
import { cx, Spinner } from "@/components/ui/primitives";
import { track } from "@/lib/analytics";

export type StreamingMessage = {
  mode_used: string;
  content: string;
  /** Arrives before any body text (its own SSE event), so the gist is the
   *  first thing on screen and the body streams in behind the fold. */
  crux?: string | null;
  /** The verdict box, when its event has landed - normally before the gist. */
  decisionReview?: DecisionReviewData | null;
  thinkingReview?: ThinkingReviewData | null;
  /** Co-Creative: the picture, once it has finished. Usually lands after the
   *  answer has streamed - generating one takes ten to twenty seconds. */
  generatedImage?: GeneratedImage | null;
  /** True between "a picture is being made" and the picture arriving. */
  makingImage?: boolean;
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
  thinkingLabel,
  onClarifierAnswer,
  onUseMode,
  onAskRefined,
  loading,
  onSubmitEdit,
  emptyState,
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
  /** Named progress for the indicator ("Searching the web"); phone layout only, set by ChatView. */
  thinkingLabel?: string | null;
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
  /** Shown in the middle of a chat with nothing in it yet. Passed in rather
   *  than built here because this list is also the landing page's guest
   *  demo, which has no account and must not greet anybody by name. */
  emptyState?: ReactNode;
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

  // True while our own smooth scroll is travelling. Its in-between positions
  // fire scroll events that look exactly like the reader scrolling up, and
  // used to switch following off halfway down - the new answer then grew
  // below the fold with nothing scrolling after it.
  const autoScrolling = useRef(false);

  /* Phone only: a "jump to latest" button once you are more than a screen
   * up, and your place in each chat kept for the session - leave a chat
   * halfway through and come back, and it opens where you were rather than
   * at the bottom. Per chat, in sessionStorage, dropped once you're back at
   * the bottom. */
  const phone = usePhoneLayout();
  const [showJump, setShowJump] = useState(false);
  const placeKey = `clardentity-place:${conversationId}`;
  const savePlace = useRef(0);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = fromBottom < 80;
    if (phone) {
      setShowJump(fromBottom > el.clientHeight);
      if (!savePlace.current) {
        savePlace.current = requestAnimationFrame(() => {
          savePlace.current = 0;
          const box = scrollRef.current;
          if (!box) return;
          try {
            if (box.scrollHeight - box.scrollTop - box.clientHeight < 80) sessionStorage.removeItem(placeKey);
            // unrounded: under the root zoom a rounded value snaps a pixel
            // further on restore, and the place crept on every visit
            else sessionStorage.setItem(placeKey, box.scrollTop.toFixed(2));
          } catch {
            // storage blocked: the chat simply opens at the bottom
          }
        });
      }
    }
    if (autoScrolling.current) {
      if (atBottom) autoScrolling.current = false;
      return;
    }
    // 80px of slack, so "near enough the bottom" survives the last line of a
    // message and a rounding error.
    stickToBottom.current = atBottom;
  }

  const lastMessageId = messages.at(-1)?.id ?? null;

  // Back to where you were in this chat - once, as the thread first renders,
  // and before the effects below would carry it to the bottom.
  const placeRestored = useRef(false);
  const hasMessages = messages.length > 0;
  useLayoutEffect(() => {
    const el = scrollRef.current; // absent while the history is loading
    if (placeRestored.current || !phone || !hasMessages || !el) return;
    placeRestored.current = true;
    let saved: number | null = null;
    try {
      const raw = sessionStorage.getItem(placeKey);
      saved = raw === null ? null : Number(raw);
    } catch {
      saved = null;
    }
    if (saved === null || !Number.isFinite(saved)) return;
    stickToBottom.current = false;
    el.scrollTop = saved;
    // WebKit floors scroll positions to whole device pixels under the root
    // zoom: a restore can land a pixel short, and a pixel shorter each visit.
    if (saved - el.scrollTop >= 0.5) el.scrollTop = saved + 1;
  }, [phone, hasMessages, placeKey, loading]);

  useEffect(() => () => cancelAnimationFrame(savePlace.current), []);

  function jumpToLatest() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = true;
    autoScrolling.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    setTimeout(() => (autoScrolling.current = false), 800);
  }

  // A new message - yours or its answer - is the moment you want to be at the
  // bottom, so this one is smooth and deliberate.
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (!el) return;
    // Already there: no scroll will happen, so no scroll event would ever
    // release the flag below - and a reader scrolling up in the next 800ms
    // would be ignored, then yanked down by the next message.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 2) return;
    autoScrolling.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    // Released when the scroll reaches the bottom (handleScroll), or after
    // this long whatever happened - a finger may have stopped it.
    const release = setTimeout(() => (autoScrolling.current = false), 800);
    return () => clearTimeout(release);
  }, [lastMessageId, busy]);

  // An answer keeps growing after it lands - the analysis, badges and footer
  // arrive with `final`, seconds later. While the reader is following, follow
  // that too, instead of leaving the end of the answer below the fold.
  useEffect(() => {
    const el = scrollRef.current;
    const last = el?.lastElementChild;
    if (!el || !last || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(last);
    return () => observer.disconnect();
  }, [lastMessageId, busy]);

  // Streaming text arrives many times a second; smooth scrolling that would
  // queue an animation per token and visibly lag the text.
  // Coalesced to one jump per frame: tokens can land several to a frame, and
  // a layout read + write for each made the follow judder on slower phones.
  const followFrame = useRef(0);
  useEffect(() => {
    if (!stickToBottom.current || followFrame.current) return;
    followFrame.current = requestAnimationFrame(() => {
      followFrame.current = 0;
      const el = scrollRef.current;
      if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
    });
  }, [streaming?.content]);
  useEffect(() => () => cancelAnimationFrame(followFrame.current), []);

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
      // min-h-0 + overflow so this gives way, on a short screen, to a gate
      // card and the composer beneath it rather than pushing them off the
      // bottom - the same reason the thread itself scrolls.
      //
      // This was deliberately empty: the design puts nothing above the
      // composer on a new chat, on the grounds that a paragraph explaining
      // the rail and the box is a paragraph nobody reads twice. Still true
      // of a paragraph. A greeting is not a paragraph, it is the room
      // acknowledging you walked in, and it was asked for by name. The
      // space is kept either way so the composer sits on the centre line.
      <div className="flex min-h-0 flex-1 items-center justify-center px-4">
        {emptyState}
      </div>
    );
  }

  return (
    // The wrapper holds the jump button over the thread; it takes the flex
    // slot the thread used to, so the layout is the same.
    <div className="relative flex min-h-0 flex-1 flex-col">
    {/* min-h-0 is required for overflow-y-auto to engage: a flex item defaults
        to min-height:auto, which sizes it to its content and defeats scrolling. */}
    <div
      ref={scrollRef}
      data-testid="message-list"
      onScroll={handleScroll}
      // A finger or a wheel is the reader, never our own smooth scroll.
      onTouchStart={() => (autoScrolling.current = false)}
      onWheel={() => (autoScrolling.current = false)}
      // max-sm:pb-20: room for the companion, which floats over the end of
      // the thread on a phone (ChatView), so the last line can scroll clear.
      className="scroll-slim min-h-0 flex-1 animate-[fade-in_0.35s_ease] space-y-5 overflow-y-auto px-1 py-5 max-sm:pb-20"
    >
      {messages.map((m) => (
        <ErrorBoundary
          key={m.id}
          where="message"
          label={m.role === "user" ? "This message couldn't be shown." : "This answer couldn't be shown."}
        >
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
          generatedImage={m.generated_image}
          thinkingReview={m.thinking_review}
          feedback={m.feedback}
          siblingIndex={m.sibling_index}
          siblingCount={m.sibling_count}
          siblingIds={m.sibling_ids}
          onSwitchBranch={onSwitchBranch}
          isPlaying={playingMessageId === m.id}
          onPlayAudio={
            onPlayAudio
              ? () => {
                  track("answer_listened");
                  onPlayAudio(m.id, m.content ?? "");
                }
              : undefined
          }
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
        </ErrorBoundary>
      ))}
      {/* Generation happens under the hood. Until the gist lands, the whole
          wait is the rabbit; the body text that streams in meanwhile is
          accumulated (so cancelling mid-way still has it) but never shown
          token by token - the finished answer replaces this all at once. */}
      {busy && !streaming?.crux && !streaming?.decisionReview && !streaming?.thinkingReview && (
        <div className="flex justify-start">
          <div className="rounded-2xl rounded-bl-md border border-hairline bg-surface px-4 py-3">
            <ThinkingIndicator label={thinkingLabel} />
          </div>
        </div>
      )}
      {/* The bubble appears as soon as there is a gist to show - the gist is
          the first thing read, and the rest is still being written behind
          it (the rabbit says so, under the card). */}
      {(streaming?.crux || streaming?.decisionReview || streaming?.thinkingReview) && (
        <ErrorBoundary where="streaming-answer" label="This answer couldn't be shown.">
        <MessageBubble
          id="streaming"
          role="assistant"
          content={streaming.content}
          modeUsed={streaming.mode_used}
          confidenceScore={null}
          confidenceBand={null}
          claims={[]}
          crux={streaming.crux ?? null}
          decisionReview={streaming.decisionReview ?? null}
          generatedImage={streaming.generatedImage ?? null}
          makingImage={streaming.makingImage ?? false}
          thinkingReview={streaming.thinkingReview ?? null}
          isStreaming
        />
        </ErrorBoundary>
      )}
    </div>
    {phone && showJump && (
      <button
        type="button"
        onClick={jumpToLatest}
        aria-label="Jump to the latest message"
        className="tap-area absolute bottom-3 left-1/2 z-10 flex size-10 -translate-x-1/2 items-center justify-center rounded-full border border-hairline bg-surface-raised text-ink shadow-lg animate-[fade-in_0.2s_ease] lg:hidden"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </button>
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

/** Citation markers become popovers, and the light formatting (bold,
 *  italic, code) renders around them - the formatting is split first so a
 *  marker inside a bold run still gets its pill. */
function renderCitations(text: string, claims: Claim[], keyPrefix: string): ReactNode[] {
  return renderInline(text, keyPrefix, (leaf, key) => renderMarkers(leaf, claims, key));
}

function renderMarkers(text: string, claims: Claim[], keyPrefix: string): ReactNode[] {
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

/* The body of an answer: paragraphs, lists and comparison tables (see
 * lib/markdown for the set and the splitter), each run of text going
 * through the citation-and-opinion renderer. A comparison the model wrote
 * as pipe rows becomes a real table, markers inside the cells included. */
function renderBody(text: string, claims: Claim[]): ReactNode {
  const clean = cleanMessageText(text);
  const blocks = splitBlocks(clean);
  if (blocks.length === 1 && blocks[0].kind === "text") {
    return renderTextWithCitations(clean, claims);
  }
  return blocks.map((block, n) => {
    if (block.kind === "text") {
      return <span key={`b${n}`}>{renderTextWithCitations(block.text, claims)}</span>;
    }
    if (block.kind === "list") {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={`b${n}`}
          className={cx(
            "my-1.5 space-y-1 pl-5 whitespace-normal",
            block.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {block.items.map((item, i) => (
            <li key={i} className="whitespace-pre-wrap">
              {renderTextWithCitations(item, claims)}
            </li>
          ))}
        </Tag>
      );
    }
    return (
      <span key={`b${n}`} className="my-2 block overflow-x-auto whitespace-normal">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {block.rows[0].map((cell, c) => (
                <th
                  key={c}
                  className="border-b border-hairline-strong px-2 py-1.5 align-bottom font-semibold text-ink"
                >
                  {renderCitations(cell, claims, `h${n}-${c}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.slice(1).map((row, r) => (
              <tr key={r} className="border-b border-hairline last:border-b-0">
                {row.map((cell, c) => (
                  <td key={c} className="px-2 py-1.5 align-top text-ink-secondary">
                    {renderCitations(cell, claims, `c${n}-${r}-${c}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </span>
    );
  });
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
              <div className="max-w-[88%] rounded-xl rounded-bl-sm bg-white/15 px-2.5 py-1.5 text-sm leading-snug">
                <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-white/70">
                  Clardentity
                </span>
                <span className="whitespace-pre-wrap">{x.question}</span>
              </div>
            </div>
            {x.answer && (
              <div className="flex justify-end">
                <div className="max-w-[88%] rounded-xl rounded-br-sm bg-white px-2.5 py-1.5 text-sm leading-snug text-brand">
                  <span className="mb-0.5 block text-xs font-semibold uppercase tracking-wide text-brand/70">
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
  generatedImage,
  makingImage,
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
  generatedImage?: GeneratedImage | null;
  makingImage?: boolean;
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
    <div data-testid="message" data-role={role} className={`group/msg flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={
          isUser
            // Grey, not burgundy, and the same 20px the composer types at:
            // the design gives your own message a step off the canvas and
            // keeps the brand for the one control you press. A column of
            // filled brand blocks was the loudest thing on a page whose
            // subject is the answer underneath them.
            ? "max-w-[78%] rounded-[12px] bg-bubble-mine px-[23px] py-[11px] text-xl leading-[normal] text-ink"
            : "w-full max-w-[88%] rounded-2xl rounded-bl-md border border-hairline bg-surface px-4 py-3 text-sm text-ink"
        }
      >
        {!isUser && (
          <div className="mb-2 flex items-center justify-between gap-2">
            {/* Mode only. The reasoning lens the agent picked is deliberately
                never surfaced - it is an internal choice about how to think,
                and naming it ("critical", "non-linear") asked the reader to
                hold a vocabulary that was only ever meant for the model. */}
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              {/* The band badge beside this one has to stay on one line, so
                  when the row runs out of width it is the mode name that
                  gives way. */}
              <span className="truncate">{modeLabel(modeUsed)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {/* Only when there is a back to turn to: either one already
                  generated with the answer, or a conversation the fetch can
                  ask. Without both - the landing page's guest demo - the
                  button flipped the card to a blank face. */}
              {!isStreaming && content && (counterfactual || conversationId) && (
                <FlipButton
                  flipped={devil.flipped}
                  onClick={() => {
                    if (!devil.flipped) track("counterfactual_flipped");
                    devil.toggle();
                  }}
                />
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
                <ConfidenceBadge band={confidenceBand} score={confidenceScore} claims={claims} />
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
        {/* The picture leads, when there is one: it is the answer to "draw
            me a logo", not an illustration of a paragraph. */}
        {!isUser && generatedImage && <GeneratedImageCard image={generatedImage} />}
        {!isUser && !generatedImage && makingImage && <GeneratedImagePlaceholder />}
        {/* The reasoning-contrast / decision-verdict box is the analysis
            itself, not detail to hide behind a click - it leads, above the
            gist (the client's order: verdict box, then the one-line answer,
            then the journey folded beneath), with the raw paragraph text
            tucked behind a mode-named expand toggle below. */}
        {!isUser && panel === "thinking" && thinkingReview && (
          <ThinkingReview review={thinkingReview} />
        )}
        {!isUser && panel === "decision" && decisionReview && (
          <DecisionReview review={decisionReview} />
        )}
        {/* The box's slot, held while it is still being written, so the
            order box -> gist -> journey is visible from the first frame
            rather than the box dropping in above things already read. */}
        {!isUser &&
          isStreaming &&
          ((panel === "decision" && !decisionReview) || (panel === "thinking" && !thinkingReview)) && (
            <div className="mb-3 rounded-[12px] border border-dashed border-hairline-strong p-4">
              <ThinkingIndicator
                compact
                label={panel === "decision" ? "Weighing the decisions" : "Working out how to think about this"}
              />
            </div>
          )}
        {hasCrux && <CruxCard text={crux as string} />}
        {isStreaming && (hasCrux || decisionReview || thinkingReview) && (
          // The rest is still being written, out of sight. No fold yet -
          // there's nothing finished behind it to open. (While only the
          // box's held slot is showing, that slot carries the rabbit.)
          <ThinkingIndicator compact />
        )}
        {hasCrux && !isStreaming && (
          <button
            type="button"
            onClick={() => setDetailOpen((v) => !v)}
            aria-expanded={detailOpen}
            className="group -mx-1 mb-2 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-secondary"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={cx("size-4 shrink-0 transition-transform", detailOpen && "rotate-90")}
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
              className="w-full resize-none rounded-lg bg-surface px-2 py-1.5 text-xl leading-[normal] text-ink outline-none ring-1 ring-hairline-strong focus:ring-brand-border"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2 text-xs">
              <span className="mr-auto text-ink-muted">Enter to resend, Esc to cancel</span>
              <button
                type="button"
                onClick={() => {
                  setDraft(content);
                  setEditing(false);
                }}
                className="rounded-md px-2 py-0.5 text-ink-secondary transition-colors hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-md bg-brand px-2 py-0.5 font-medium text-white transition-colors hover:bg-brand-dark"
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
              // div, not p: a comparison renders as a real <table>, which
              // cannot live inside a paragraph element.
              // The same step the question above it is set in. The card's
              // own chrome - the mode, the band, the actions - stays small;
              // it is the answer that has to be as readable as the thing it
              // is answering, and it was a step below it.
              <div className="whitespace-pre-wrap break-words text-xl leading-relaxed">
                {renderBody(content, claims)}
              </div>
            }
          />
        )}
        {!isUser && !isStreaming && !editing && <SourcesFooter claims={claims} />}

        {isValidating && (
          // The answer above is complete and saved. This says what is still
          // happening, so a message that gains a score a few seconds later
          // doesn't look like it changed on its own.
          <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
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
            side={isUser ? "mine" : "theirs"}
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
            side={isUser ? "mine" : "theirs"}
          />
        )}
        {!isStreaming && createdAt && (
          // Its own row, not folded into MessageActions: that row hides
          // itself until hovered on a user bubble, and a timestamp you have
          // to hover to see isn't one you can glance at.
          <time
            dateTime={createdAt}
            className={cx(
              "mt-1 block text-xs tabular-nums",
              isUser ? "text-right text-ink-muted" : "text-ink-muted",
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
  side,
}: {
  siblingIds: string[];
  siblingIndex: number;
  onSwitchBranch: (messageId: string) => void;
  /** Whose message this row belongs to. It no longer changes the colours -
   *  the bubble is grey now - only where the row sits and whether it waits
   *  for a hover. */
  side: "mine" | "theirs";
}) {
  const count = siblingIds.length;
  const base =
    "text-ink-muted hover:bg-surface-hover hover:text-ink";

  return (
    <div
      className={cx(
        "mt-1.5 flex items-center gap-0.5 text-xs text-ink-muted",
        side === "mine" && "justify-end",
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
  side,
}: {
  content: string;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onDelete?: () => void;
  busy?: boolean;
  /** Whose message this row belongs to. It no longer changes the colours -
   *  the bubble is grey now - only where the row sits and whether it waits
   *  for a hover. */
  side: "mine" | "theirs";
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
    "text-ink-muted hover:bg-surface-hover hover:text-ink";

  return (
    <div
      className={cx(
        "mt-2 flex items-center gap-0.5 transition-opacity",
        "group-hover/msg:opacity-100 focus-within:opacity-100",
        // An answer's actions stay visible. Hover-only was fine for your own
        // messages - short, and you know what you wrote - but on a response
        // it put Copy behind a hover, below the evidence panel, where nobody
        // found it. Under your own bubble a permanent row is just noise.
        side === "mine" ? "justify-end opacity-0" : "opacity-45",
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
          onClick={() => {
            track("answer_regenerated");
            onRegenerate();
          }}
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
              "rounded-md px-1.5 py-1 text-xs font-semibold uppercase tracking-wide transition-colors disabled:opacity-40",
              "text-band-low",
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
