"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/apiClient";
import { authErrorMessage, getAccessToken } from "@/lib/auth";
import {
  streamChatMessage,
  type ChatMessage,
  type RefinedQuestionSuggestion,
  type ClarifyingOptionsSuggestion,
  type DecisionReviewData,
  type ThinkingReviewData,
} from "@/lib/sse";
import { ModeSelector, type CognitiveMode } from "@/components/chat/ModeSelector";
import { MessageList, type StreamingMessage } from "@/components/chat/MessageList";
import { ModeCarousel, groupByMode } from "@/components/chat/ModeCarousel";
import { MessageInput, type PendingImage } from "@/components/chat/MessageInput";
import { LiveCallOverlay } from "@/components/chat/LiveCallOverlay";
import { UpgradeDialog } from "@/components/chat/UpgradeDialog";
import { COMING_SOON_MODES, DEFAULT_MODE, MODE_BY_VALUE, type PickableMode } from "@/lib/modes";
import { setSmartSwitching, useSmartSwitching } from "@/lib/modeSwitching";
import { ContextQuestionCard } from "@/components/chat/ContextQuestionCard";
import { ModeSwitchToast } from "@/components/chat/ModeSwitchToast";
import { RefinedQuestionCard } from "@/components/chat/RefinedQuestionCard";
import { ClarifyingOptionsCard } from "@/components/chat/ClarifyingOptionsCard";
import { cx } from "@/components/ui/primitives";
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
  workspace_id: string;
};

type AvatarCue = { expression: AvatarExpression; gesture: AvatarGesture };

/** How long an answer may go with nothing to show before the Quick answer
 *  button appears on its own (the server's "slow" warning shows it sooner). */
const SLOW_AFTER_MS = 7000;

const GESTURE_BY_MODE: Record<CognitiveMode, AvatarGesture> = {
  knowing: "presenting",
  thinking: "chin_stroke",
  decision: "weighing_scales",
  learning: "open_hand_explaining",
  mentoring: "open_hand_explaining",
  therapy: "chin_stroke",
  creative: "presenting",
  rapid: "presenting",
  legal: "open_hand_explaining",
};

export function ChatView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Distinct from "no messages". Without it, reopening a chat rendered the
  // "Start a chat" empty state for the second or two the fetch took.
  const [loadingHistory, setLoadingHistory] = useState(true);
  // Never null in practice: a new chat opens in Finder, always - not in
  // whatever this device last used, which had a Decision-making chat
  // reopening the composer in Decision-making and read as the wrong
  // default. A chat's own remembered mode, if it has one, replaces it once
  // history loads. The type keeps `null` only because ModeSelector and the
  // gates below still speak it.
  const [mode, setMode] = useState<CognitiveMode | null>(DEFAULT_MODE);
  // Smart switching: the companion may stop and propose a better-suited mode
  // before answering. Manual: never. See lib/modeSwitching.
  const smartSwitching = useSmartSwitching();
  // Set when the companion switched mode for a question. Smart switching is
  // automatic: the suggestion is taken and the answer written in the new
  // mode straight away, with this banner saying so - and, while that answer
  // is still being written, offering to stop it and answer in the original
  // mode instead (hence the question itself is kept here). Afterwards it
  // offers the way back for the *next* question - "how do I go back to
  // Knowing?" was the first thing asked.
  const [switchedFrom, setSwitchedFrom] = useState<{
    from: CognitiveMode;
    to: CognitiveMode;
    content: string;
    images: PendingImage[];
    // The gate flags the switched send carried, so answering in the old
    // mode instead re-sends with them intact - without them the server
    // asked the context question a second time, in the other mode.
    flags: { contextAcknowledged: boolean; contextRounds: number; refinedConfirmed: boolean; clarifyingConfirmed: boolean };
  } | null>(null);
  // The ten-second card over the composer right after an automatic switch
  // (see ModeSwitchToast). Cleared when it runs out, when reverted, or when
  // the answer it refers to is stopped.
  const [switchToast, setSwitchToast] = useState(false);
  // Stable, so the toast's countdown effect doesn't restart each render.
  const dismissSwitchToast = useCallback(() => setSwitchToast(false), []);
  // Which locked mode (or model) opened the plans dialog, for its headline.
  const [upsell, setUpsell] = useState<string | null>(null);
  // "Quick answer" - the way out of a slow answer. Shown while an answer is
  // being written once the server has said it will take a while (a status
  // event with phase "slow": no documents matched, so a web search and the
  // checking that follows are ahead) or, failing that, once a fixed number
  // of seconds have passed with nothing to show. Tapping it stops the
  // answer and asks the same question down the quick path: no gates, no
  // search, no checking, the gist in a few seconds. Not a mode anyone picks
  // - the composer stays in whatever they were in.
  const [slowHint, setSlowHint] = useState(false);
  const lastSendRef = useRef<{ content: string; images: PendingImage[]; mode: CognitiveMode } | null>(
    null,
  );
  // The verdict box that arrived during streaming, until "final" writes it
  // onto the message itself.
  const earlyReviewRef = useRef<{
    decision_review?: DecisionReviewData | null;
    thinking_review?: ThinkingReviewData | null;
  } | null>(null);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [sending, setSending] = useState(false);
  // The message whose claims are still being verified. It is already on
  // screen and already saved; this only drives the "checking claims" note.
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [avatarCue, setAvatarCue] = useState<AvatarCue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  // The composer's text lives here so editing a sent message can put it back.
  const [draft, setDraft] = useState("");
  // Carousel (split-by-mode) view is opt-IN, and only offered once a second
  // mode exists - "read as one thread" is the default view.
  const [carousel, setCarousel] = useState(false);
  const [activeTrack, setActiveTrack] = useState(0);
  const [callOpen, setCallOpen] = useState(false);
  // The server asked why before answering. Holds the accumulated send so far
  // (the original message plus any earlier rounds already answered) so a
  // reply is appended rather than replacing it, and `rounds` so the resend
  // can tell the server how many rounds have already run - the gate can fire
  // more than once per turn, up to a cap on the server.
  const [pendingContext, setPendingContext] = useState<{
    question: string;
    content: string;
    images: PendingImage[];
    mode: CognitiveMode;
    rounds: number;
  } | null>(null);
  // The server asked "did you mean" before answering. Holds the original
  // send so either choice can replay it - same shape as pendingMode, since
  // this is a single yes/no suggestion too, not a multi-round exchange.
  const [pendingRefined, setPendingRefined] = useState<{
    suggestion: RefinedQuestionSuggestion;
    content: string;
    images: PendingImage[];
    mode: CognitiveMode;
  } | null>(null);
  // The server asked "which did you mean" before answering, with tappable
  // options - same shape as pendingRefined, since this is also a single
  // exchange rather than a multi-round one.
  const [pendingClarifyingOptions, setPendingClarifyingOptions] = useState<{
    suggestion: ClarifyingOptionsSuggestion;
    content: string;
    images: PendingImage[];
    mode: CognitiveMode;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Lets the stop button cut the current request off mid-stream. Recreated
  // per send rather than reused, since an aborted controller can't un-abort.
  const abortControllerRef = useRef<AbortController | null>(null);
  // Whether the in-flight send has already reached onAnswer - decides what
  // stopping early should do to the optimistic user bubble. Before onAnswer,
  // nothing was written server-side (same as any gate), so stopping should
  // roll it back; after, the assistant row already exists and stays, just
  // without the analysis that was still running.
  const hasAnsweredRef = useRef(false);
  const pendingUserMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiFetch<Conversation>(`/chat/conversations/${conversationId}`),
      apiFetch<ChatMessage[]>(`/chat/${conversationId}/messages`),
    ])
      .then(([conv, msgs]) => {
        if (cancelled) return;
        setMessages(msgs);
        setLoadingHistory(false);
        // Only a mode from the picker: a chat whose last answer was a quick
        // one must not reopen with the composer set to the unpickable path.
        if (conv.default_mode && MODE_BY_VALUE[conv.default_mode]) setMode(conv.default_mode);

        const lastCued = [...msgs].reverse().find((m) => m.avatar_expression && m.avatar_gesture);
        if (lastCued) {
          setAvatarCue({
            expression: lastCued.avatar_expression as AvatarExpression,
            gesture: lastCued.avatar_gesture as AvatarGesture,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(authErrorMessage(err));
        setLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function handleSend(
    content: string,
    images: PendingImage[],
    // Regenerating re-sends in the mode the original turn used. `mode` state
    // may not have caught up yet - setMode in the same tick doesn't apply
    // until the next render - so the caller passes it explicitly.
    modeOverride?: CognitiveMode,
    // The user has answered the mode question, either way. Stops the server
    // asking again about a question it already asked about.
    modeConfirmed = false,
    // Set once the user explicitly skips the pre-answer "why" ("Answer
    // without this") - a hard stop, regardless of how many rounds have run.
    contextAcknowledged = false,
    // How many context-gate rounds have already been answered for this turn.
    // The server caps further asking at MAX_CONTEXT_ROUNDS.
    contextRounds = 0,
    // Forking overrides, used only by handleRegenerate/handleSubmitEdit below
    // - a normal send from the composer passes neither. `regenerateOf` skips
    // creating a new user message entirely (the server attaches the new
    // answer as a sibling of the existing one); `parentId` attaches a new
    // user message as a sibling of some earlier one, rather than continuing
    // from wherever the conversation currently is.
    fork?: { parentId?: string | null; regenerateOf?: string },
    // The user has answered the refined-phrasing suggestion, either way -
    // asking it as worded or keeping their own. Appended as a final param
    // (rather than inserted earlier) so every existing call site above stays
    // valid unchanged; regenerate is the one caller that needs to pass true
    // explicitly, since re-answering an already-settled question must never
    // interrupt with this suggestion again.
    refinedConfirmed = false,
    // Same reasoning, for the clarifying-options gate: appended last so
    // nothing above needs updating, defaulting to re-eligible except for
    // regenerate.
    clarifyingConfirmed = false,
  ) {
    const sendMode = modeOverride ?? mode;
    if (!sendMode) return;
    setPendingContext(null);
    setPendingRefined(null);
    setPendingClarifyingOptions(null);

    setError(null);
    setSending(true);
    setIsTyping(false);

    // Regenerating writes no new user row server-side, so there's nothing
    // optimistic to show above the streaming answer - the question already
    // on screen stays exactly where it is.
    const userMessage: ChatMessage | null = fork?.regenerateOf
      ? null
      : {
          id: `local-${Date.now()}`,
          role: "user",
          content,
          mode_used: sendMode,
          reasoning_lens: null,
          confidence_score: null,
          confidence_band: null,
          avatar_expression: null,
          avatar_gesture: null,
          created_at: new Date().toISOString(),
          counterfactual_content: null,
          crux_text: null,
          clarifier: null,
          guidance: null,
          decision_review: null,
          thinking_review: null,
          feedback: null,
          parent_id: fork?.parentId ?? null,
          sibling_index: 0,
          sibling_count: 1,
          sibling_ids: [],
          claims: [],
        };
    if (userMessage) setMessages((prev) => [...prev, userMessage]);
    setStreaming({ mode_used: sendMode, content: "" });
    lastSendRef.current = { content, images, mode: sendMode };
    earlyReviewRef.current = null;
    setSlowHint(false);

    hasAnsweredRef.current = false;
    pendingUserMessageIdRef.current = userMessage?.id ?? null;
    const controller = new AbortController();
    abortControllerRef.current = controller;

    await streamChatMessage(
      conversationId,
      {
        content,
        mode: sendMode,
        attachments: images.map((img) => ({
          type: "image",
          data: img.data,
          mime_type: img.mimeType,
        })),
        // Manual switching means the server never gets to ask.
        mode_confirmed: modeConfirmed || !smartSwitching,
        context_acknowledged: contextAcknowledged,
        context_rounds: contextRounds,
        refined_confirmed: refinedConfirmed,
        clarifying_confirmed: clarifyingConfirmed,
        parent_id: fork?.parentId,
        regenerate_of: fork?.regenerateOf,
      },
      {
        onStatus: (status) => {
          // The only phase the client acts on: the server's early warning
          // that this answer will be a long one. Every other label stays
          // under the hood (the rabbit only ever says Thinking).
          if (status.phase === "slow" && sendMode !== "rapid") setSlowHint(true);
        },
        onReview: (review) => {
          // Kept aside as well: the "answer" event's message carries no
          // review yet (it is written to the row at "final"), and swapping
          // the streaming bubble for it made the box vanish for the length
          // of the verification and reappear - the exact flicker the order
          // change was meant to remove.
          earlyReviewRef.current = review;
          setStreaming((prev) =>
            prev
              ? {
                  ...prev,
                  decisionReview: review.decision_review ?? prev.decisionReview ?? null,
                  thinkingReview: review.thinking_review ?? prev.thinkingReview ?? null,
                }
              : prev,
          );
        },
        onCrux: (text) => {
          setSlowHint(false);
          setStreaming((prev) => (prev ? { ...prev, crux: text } : prev));
        },
        onDelta: (text) => {
          // Accumulated, not shown: the body is revealed whole when the
          // stream finishes (MessageList renders only the gist and the
          // rabbit until then).
          setStreaming((prev) =>
            prev ? { ...prev, content: prev.content + text } : prev,
          );
        },
        onAnswer: (message, realUserMessage) => {
          // The text is written and saved; only the analysis is outstanding.
          // Waiting for that to finish before letting you type again is what
          // made the app feel like it was still working long after it had
          // clearly finished answering.
          hasAnsweredRef.current = true;
          setSlowHint(false);
          setMessages((prev) => {
            // Swap the optimistic question for the real, persisted row - it
            // was displayed under a local placeholder id before the server
            // ever assigned one, and anything that addresses it by id from
            // here on (delete, in particular) needs the real one.
            const withRealUser =
              userMessage && realUserMessage
                ? prev.map((m) => (m.id === userMessage.id ? realUserMessage : m))
                : prev;
            const early = earlyReviewRef.current;
            const carried = early
              ? {
                  ...message,
                  decision_review: message.decision_review ?? early.decision_review ?? null,
                  thinking_review: message.thinking_review ?? early.thinking_review ?? null,
                }
              : message;
            return [...withRealUser, carried];
          });
          setStreaming(null);
          setSending(false);
          setValidatingId(message.id);
        },
        onFinal: (finalEvent) => {
          setMessages((prev) => {
            const index = prev.findIndex((m) => m.id === finalEvent.message.id);
            if (index === -1) return [...prev, finalEvent.message];
            // Replace in place: reflection may have edited the text, and the
            // claims and score arrive only now.
            const next = [...prev];
            next[index] = finalEvent.message;
            return next;
          });
          setValidatingId(null);
          setStreaming(null);
          setSending(false);
          if (finalEvent.conversation_title) {
            // The shell owns the sidebar row and the breadcrumb; tell it.
            window.dispatchEvent(
              new CustomEvent("clardentity:conversation-renamed", {
                detail: { id: conversationId, title: finalEvent.conversation_title },
              }),
            );
          }
          if (finalEvent.avatar_cue) {
            setAvatarCue({
              expression: finalEvent.avatar_cue.expression as AvatarExpression,
              gesture: finalEvent.avatar_cue.gesture as AvatarGesture,
            });
          }
          setReacting(true);
          setTimeout(() => setReacting(false), 700);
        },
        onModeSuggestion: (suggestion) => {
          // Nothing was written server-side, so the optimistic user message is
          // rolled back too - it will be re-sent for real once they choose.
          // (Regenerating never reaches this - the server skips the mode
          // gate entirely for it - so there's no optimistic message to roll
          // back in that case.)
          if (userMessage) setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
          setStreaming(null);
          setSending(false);
          const next = suggestion.suggested_mode as PickableMode;
          if (COMING_SOON_MODES.includes(next)) {
            // Outside what can be started today: show the plans, and answer
            // in the mode they chose meanwhile - closing the dialog without
            // choosing simply leaves them where they were.
            setUpsell(MODE_BY_VALUE[next]?.label ?? next);
            void handleSend(
              content, images, sendMode, true, contextAcknowledged, contextRounds,
              undefined, refinedConfirmed, clarifyingConfirmed,
            );
            return;
          }
          // Automatic: switch, say so, and answer. The banner under the mode
          // strip carries "answer in <old mode> instead" for as long as the
          // answer is being written.
          setMode(next);
          const flags = { contextAcknowledged, contextRounds, refinedConfirmed, clarifyingConfirmed };
          setSwitchedFrom({ from: sendMode, to: next, content, images, flags });
          setSwitchToast(true);
          void handleSend(
            content, images, next, true, contextAcknowledged, contextRounds,
            undefined, refinedConfirmed, clarifyingConfirmed,
          );
        },
        onContextQuestion: (asked) => {
          // Nothing was written server-side, so the optimistic user message is
          // rolled back the same way the mode gate rolls it back. `content`
          // here is already the accumulated text (original message plus any
          // earlier rounds) since it's what this call was sent with.
          if (userMessage) setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
          setPendingContext({
            question: asked.question,
            content,
            images,
            mode: sendMode,
            rounds: contextRounds,
          });
          setStreaming(null);
          setSending(false);
        },
        onRefinedQuestion: (suggestion) => {
          // Nothing was written server-side, so the optimistic user message is
          // rolled back the same way the other two gates roll it back.
          // (Regenerating never reaches this - it sends refinedConfirmed=true
          // - so there's no optimistic message to roll back in that case.)
          if (userMessage) setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
          setPendingRefined({ suggestion, content, images, mode: sendMode });
          setStreaming(null);
          setSending(false);
        },
        onClarifyingOptions: (suggestion) => {
          // Nothing was written server-side, so the optimistic user message is
          // rolled back the same way the other gates roll it back.
          // (Regenerating never reaches this - it sends
          // clarifyingConfirmed=true - so there's no optimistic message to
          // roll back in that case.)
          if (userMessage) setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
          setPendingClarifyingOptions({ suggestion, content, images, mode: sendMode });
          setStreaming(null);
          setSending(false);
        },
        onError: (detail) => {
          setError(detail);
          setStreaming(null);
          setSending(false);
          setSlowHint(false);
          setValidatingId(null);
        },
      },
      controller.signal,
    );
  }

  /** Cuts the current request off mid-stream. `streamChatMessage` resolves
   *  quietly on an aborted signal (no `onError`), so the UI reset happens
   *  here rather than waiting for a handler that will not fire. Before
   *  `onAnswer`, nothing was persisted server-side - same as declining any
   *  gate - so the optimistic question is rolled back too; after it, the
   *  answer already exists and stays, just without the analysis that was
   *  still running. */
  function handleStop() {
    abortControllerRef.current?.abort();
    if (!hasAnsweredRef.current && pendingUserMessageIdRef.current) {
      const id = pendingUserMessageIdRef.current;
      setMessages((prev) => prev.filter((m) => m.id !== id));
    }
    setStreaming(null);
    setSending(false);
    setSlowHint(false);
    setValidatingId(null);
  }

  /** The Quick answer button: stop the slow answer, ask again down the quick
   *  path. `mode_confirmed` so the server never re-raises the mode gate. */
  function handleQuickAnswer() {
    const last = lastSendRef.current;
    if (!last) return;
    handleStop();
    void handleSend(last.content, last.images, "rapid", true);
  }

  // The fallback timer behind the slow hint: a stream with nothing to show
  // after this long gets the button whether or not the server warned.
  useEffect(() => {
    if (!sending || hasAnsweredRef.current) return;
    if (lastSendRef.current?.mode === "rapid") return;
    const timer = setTimeout(() => setSlowHint(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [sending]);

  // Esc is the standard "cancel what's running" key, and it only means that
  // here while something actually is - not bound at all otherwise, so it
  // doesn't shadow the edit textarea's own Escape-to-cancel-editing handler.
  useEffect(() => {
    if (!sending) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleStop();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sending]);

  /** Save what was said on a call into the thread.
   *
   *  Best-effort: the call already happened, and failing to file it is not
   *  worth an error banner over an answer the user already heard. Saved
   *  unscored - see the endpoint for why.
   */
  async function handleCallEnded(
    turns: { role: "user" | "assistant"; content: string }[],
  ) {
    if (!turns.length || !mode) return;
    try {
      const saved = await apiFetch<ChatMessage[]>(
        `/chat/${conversationId}/call-transcript`,
        { method: "POST", body: { mode, turns } },
      );
      setMessages((prev) => [...prev, ...saved]);
    } catch {
      // Nothing to say here that the user could act on.
    }
  }

  /** Regenerate: an alternate answer to the same question, as a sibling of
   *  the old one - nothing is deleted, so the original stays reachable via
   *  the fork switcher's arrows.
   *
   *  Only the answer itself moves locally (dropped, then replaced by
   *  whatever streams in) - the question above it is untouched, since the
   *  server isn't writing a new one either. */
  async function handleRegenerate(messageId: string) {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const target = messages[index];
    if (target.role !== "assistant") return;

    setError(null);
    setMessages((prev) => prev.slice(0, index));
    try {
      await handleSend(
        "",
        [],
        target.mode_used as CognitiveMode,
        true,
        true,
        0,
        { regenerateOf: target.id },
        true,
        true,
      );
      // The streamed-in message carries no sibling count of its own - only
      // list_messages computes that, by looking at every row sharing its
      // parent. A reload is what turns "there are now two answers" into the
      // switcher actually showing 1/2.
      await reloadMessages();
    } catch (err) {
      setError(authErrorMessage(err));
      await reloadMessages();
    }
  }

  /** Edit: a new sibling of the edited message, not a rewrite of history -
   *  the old wording and everything that answered it stays reachable via the
   *  fork switcher, exactly like a regenerate does for an answer.
   *
   *  Applied only once the new text is submitted, not on the edit click
   *  itself - dropping the tail immediately would wipe the conversation
   *  before the user had typed anything and make cancelling impossible. The
   *  bubble holds the draft until then. */
  async function handleSubmitEdit(messageId: string, content: string) {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index < 0) return;
    const target = messages[index];
    const modeUsed = target.mode_used as CognitiveMode;

    setError(null);
    setMessages((prev) => prev.slice(0, index));
    setMode(modeUsed);
    try {
      await handleSend(content, [], modeUsed, false, false, 0, {
        parentId: target.parent_id,
      });
      // Same reason as handleRegenerate: the streamed-in messages don't know
      // their own sibling count until something re-reads the tree.
      await reloadMessages();
    } catch (err) {
      setError(authErrorMessage(err));
      await reloadMessages();
    }
  }

  /** Fork switcher: move to a different branch at the same point in the
   *  conversation - a sibling answer, or a sibling edit and whatever
   *  answered it - without generating anything new. The branch reopens
   *  wherever it last left off (see the active-leaf endpoint), so this is
   *  always followed by a full reload rather than trying to splice the new
   *  branch into local state by hand. */
  async function handleSwitchBranch(messageId: string) {
    setError(null);
    try {
      await apiFetch<{ active_leaf_id: string }>(
        `/chat/${conversationId}/active-leaf`,
        { method: "PUT", body: { message_id: messageId } },
      );
      await reloadMessages();
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  /** Permanently removes a message and everything after it - unlike fork/
   *  edit/regenerate, which only ever add a sibling, this actually deletes
   *  rows. Same "mutate on the backend, then full reload" pattern as branch
   *  switching: the client has no cheap way to locally recompute which
   *  messages just disappeared. */
  async function handleDeleteMessage(messageId: string) {
    setError(null);
    try {
      await apiFetch(`/chat/${conversationId}/messages/${messageId}`, { method: "DELETE" });
      await reloadMessages();
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  async function reloadMessages() {
    try {
      setMessages(await apiFetch<ChatMessage[]>(`/chat/${conversationId}/messages`));
    } catch {
      // The error from the failed action is already on screen; a second one
      // about the recovery attempt would only add noise.
    }
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

  // A conversation is only "multi-mode" once a second mode has actually been
  // used. Until then this is an ordinary chat and any splitting would be
  // ceremony around a single column.
  const tracks = groupByMode(messages);
  const multiMode = tracks.length > 1;
  // Deliberately not gated on `streaming` any more. It used to be, and the
  // cost was a full teardown on every send: the carousel unmounted, the
  // one-thread list mounted every message in the conversation at once, and
  // the column resized 6xl -> 3xl in the same frame. What that looked like
  // from the outside was the view sliding back to Knowing and locking up for
  // a few seconds. The answer now streams into its own track instead.
  const showCarousel = multiMode && carousel;

  // Which track is in focus is *derived* from the selected mode wherever that
  // mode has a track, rather than tracked separately. The two used to be
  // separate pieces of state synced one way only - focusing a track set the
  // composer's mode, but choosing a mode you had already used left the
  // carousel where it was, so clicking it looked like it did nothing.
  // `activeTrack` survives only as the fallback for a mode with no track yet
  // (one you have selected but not asked anything in), where there is nothing
  // to move to and staying put is right.
  const modeTrackIndex = tracks.findIndex((track) => track.mode === mode);
  const activeIndex =
    modeTrackIndex >= 0 ? modeTrackIndex : Math.min(activeTrack, tracks.length - 1);

  const messageListFor = (subset: ChatMessage[], streamingHere: StreamingMessage | null) => (
    <MessageList
      conversationId={conversationId}
      messages={subset}
      streaming={streamingHere}
      playingMessageId={playingMessageId}
      onPlayAudio={handlePlayAudio}
      validatingId={validatingId}
      onSubmitEdit={handleSubmitEdit}
      loading={loadingHistory}
      onRegenerate={handleRegenerate}
      onDeleteMessage={handleDeleteMessage}
      onSwitchBranch={handleSwitchBranch}
      busy={sending}
      onClarifierAnswer={(answer) => handleSend(answer, [])}
      // Switching mode from a nudge only changes the composer's mode - it
      // does not re-ask anything. The answer you already have is still the
      // answer; this sets up the next question.
      onUseMode={(next) => setMode(next as CognitiveMode)}
      onAskRefined={(question) => handleSend(question, [])}
      emptyStateAvatar={
        <AvatarPanel
          state={avatarState}
          gesture={avatarGesture}
          expression={avatarExpression}
          className="h-36 w-36"
          tourId="companion"
        />
      }
    />
  );

  return (
    // No page header. The topbar breadcrumb already says which conversation
    // this is, so a second title bar spent ~90px of a bounded-height column on
    // repeating it - and that height comes straight out of the message area.
    // The controls it held now live in the composer, which was already a row.
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Lives here rather than in the composer: a finished call has to be
          written into this conversation, and the composer doesn't know which
          one it belongs to. */}
      <LiveCallOverlay
        open={callOpen}
        onClose={() => setCallOpen(false)}
        onEnded={handleCallEnded}
      />

      <div
        className={cx(
          "mx-auto flex w-full min-h-0 flex-1 flex-col px-4 sm:px-6",
          // The carousel needs the width its neighbours are peeking into; a
          // 3xl column would clip them off the sides of the screen.
          showCarousel ? "max-w-6xl" : "max-w-3xl",
        )}
      >
        {multiMode && (
          <div className="flex shrink-0 items-center justify-end pt-2">
            <button
              type="button"
              onClick={() => setCarousel((v) => !v)}
              className="rounded-md px-2 py-1 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              {carousel ? "Read as one thread" : "Split by mode"}
            </button>
          </div>
        )}

        {showCarousel ? (
          <ModeCarousel
            tracks={tracks}
            activeIndex={activeIndex}
            onActiveIndexChange={(index) => {
              setActiveTrack(index);
              // Bringing a mode's track into focus is how you say "I want to
              // continue in this one". Leaving the composer on whatever was
              // last used meant reading the Knowing track and then, without
              // any warning, asking your next question in Thinking.
              const next = tracks[index]?.mode;
              if (next) setMode(next);
            }}
            renderMessages={(subset, trackMode) =>
              // The answer streams into the track it was asked in, not into
              // whichever one happens to be in focus.
              messageListFor(subset, streaming?.mode_used === trackMode ? streaming : null)
            }
          />
        ) : (
          messageListFor(messages, streaming)
        )}

        {/* The pre-answer gates sit between the thread and the composer as
            flex items. Left to the default rules they shrank: an item with
            overflow hidden has no automatic minimum height, so on a phone the
            options card was squeezed to a sliver behind the composer and the
            fourth option was never seen (the "follow-up boxes hidden under
            the input" reports). shrink-0 makes the thread give way instead,
            and the cap keeps a long card scrollable within itself rather than
            pushing the composer off the bottom. */}
        <div className="scroll-slim max-h-[50vh] shrink-0 overflow-y-auto">
        {pendingContext && (
          <ContextQuestionCard
            // A new round is a new question with its own fresh textarea, not
            // an update to the same one - without a key tied to the round,
            // the card's own internal draft state would carry over from the
            // previous round's box.
            key={pendingContext.rounds}
            question={pendingContext.question}
            busy={sending}
            onAnswer={(context) =>
              // Their answer joins the original message rather than replacing
              // it, so the transcript keeps both halves of what they said and
              // the model sees the whole thing as one turn. The question
              // itself is folded in too - the card asking it unmounts the
              // instant this fires (pendingContext is cleared at the top of
              // handleSend), so if the question isn't in the message text
              // itself it vanishes from the transcript entirely, both on
              // screen and in what gets saved.
              // Not context_acknowledged=true here: answering a round asks to
              // be evaluated again (the gate may have one more genuine
              // question), not to be waved through. contextRounds is what
              // caps that, on the server.
              void handleSend(
                `${pendingContext.content}\n\n(Clardentity asked: "${pendingContext.question}")\n${context}`,
                pendingContext.images,
                pendingContext.mode,
                false,
                false,
                pendingContext.rounds + 1,
              )
            }
            onSkip={() =>
              // A hard stop regardless of round count - the only way to cut
              // the gate off before it decides to stop on its own.
              void handleSend(
                pendingContext.content,
                pendingContext.images,
                pendingContext.mode,
                false,
                true,
                pendingContext.rounds,
              )
            }
          />
        )}

        {pendingRefined && (
          <RefinedQuestionCard
            refinedQuestion={pendingRefined.suggestion.refined_question}
            reason={pendingRefined.suggestion.refinement_reason}
            busy={sending}
            onAskRefined={() =>
              // Same "(Clardentity asked: ...)" embedding the context gate
              // uses, so this shows up in the transcript as a real exchange
              // rather than the user's message silently changing wording -
              // the resent content genuinely differs from what they typed,
              // and the reason why should stay visible.
              void handleSend(
                `${pendingRefined.content}\n\n(Clardentity asked: "Did you mean: ${pendingRefined.suggestion.refined_question}")\n${pendingRefined.suggestion.refined_question}`,
                pendingRefined.images,
                pendingRefined.mode,
                false,
                false,
                0,
                undefined,
                true,
              )
            }
            onKeepOriginal={() =>
              void handleSend(
                pendingRefined.content,
                pendingRefined.images,
                pendingRefined.mode,
                false,
                false,
                0,
                undefined,
                true,
              )
            }
          />
        )}

        {pendingClarifyingOptions && (
          <ClarifyingOptionsCard
            question={pendingClarifyingOptions.suggestion.question}
            options={pendingClarifyingOptions.suggestion.options}
            busy={sending}
            onAnswer={(answer) =>
              // Same "(Clardentity asked: ...)" embedding the other gates
              // use, so a tapped option (or a typed one) shows up in the
              // transcript as a real exchange rather than the next message
              // silently answering a question that isn't there.
              void handleSend(
                `${pendingClarifyingOptions.content}\n\n(Clardentity asked: "${pendingClarifyingOptions.suggestion.question}")\n${answer}`,
                pendingClarifyingOptions.images,
                pendingClarifyingOptions.mode,
                false,
                false,
                0,
                undefined,
                false,
                true,
              )
            }
            onSkip={() =>
              void handleSend(
                pendingClarifyingOptions.content,
                pendingClarifyingOptions.images,
                pendingClarifyingOptions.mode,
                false,
                false,
                0,
                undefined,
                false,
                true,
              )
            }
          />
        )}

        </div>

        {switchToast && switchedFrom && (
          <div className="shrink-0 pb-2">
            <ModeSwitchToast
              from={MODE_BY_VALUE[switchedFrom.from]?.label ?? switchedFrom.from}
              to={MODE_BY_VALUE[switchedFrom.to]?.label ?? switchedFrom.to}
              onDismiss={dismissSwitchToast}
              onRevert={() => {
                // Stop the answer being written in the suggested mode and
                // ask the same question in the one they had chosen, telling
                // the server the mode is settled so it doesn't suggest again.
                handleStop();
                const { from, content, images, flags } = switchedFrom;
                setSwitchToast(false);
                setSwitchedFrom(null);
                setMode(from);
                void handleSend(
                  content, images, from, true, flags.contextAcknowledged, flags.contextRounds,
                  undefined, flags.refinedConfirmed, flags.clarifyingConfirmed,
                );
              }}
            />
          </div>
        )}
        {sending && slowHint && !streaming?.crux && (
          // Hovers above the composer, the way a chat app offers the short
          // version while the long one is being written.
          <div className="flex shrink-0 justify-center pb-1">
            <button
              type="button"
              onClick={handleQuickAnswer}
              title="Stop this answer and get an instant, unchecked one instead"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-ink-inverse shadow-lg transition-colors hover:opacity-90 animate-[fade-in_0.3s_ease]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
              </svg>
              Quick answer
            </button>
          </div>
        )}

        {error && (
          <div className="mb-3 shrink-0 rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
            {error}
          </div>
        )}

        <div className="shrink-0 space-y-2 border-t border-hairline py-3 sm:space-y-3 sm:py-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Once there are messages the companion moves down here, beside
                the controls it reacts to. While the chat is empty it is the
                centrepiece above instead, and showing it twice would just be
                two of the same thing on one screen. */}
            {messages.length > 0 && (
              <AvatarPanel
                state={avatarState}
                gesture={avatarGesture}
                expression={avatarExpression}
                className="h-11 w-11 shrink-0"
                tourId="companion"
              />
            )}
            {/* flex-1 so the unselected state - which renders all four modes
                as cards - gets the full row instead of shrink-wrapping next
                to the avatar. */}
            <div className="min-w-0 flex-1">
              <ModeSelector
                value={mode}
                onChange={(next) => {
                  // Picking a mode by hand supersedes any accepted suggestion.
                  setSwitchedFrom(null);
                  setMode(next);
                }}
                disabled={sending}
                onLocked={(locked) => setUpsell(MODE_BY_VALUE[locked]?.label ?? locked)}
              />
            </div>
            {mode && (
              <button
                type="button"
                data-tour="switching-toggle"
                onClick={() => setSmartSwitching(!smartSwitching)}
                title={
                  smartSwitching
                    ? "Smart: a question that fits another mode better is answered there automatically, with a way back. Click for manual."
                    : "Manual: the mode is whatever you pick; it never switches. Click for smart."
                }
                className="shrink-0 rounded-md px-2 py-1 text-[11px] text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                Switching: {smartSwitching ? "Smart" : "Manual"}
              </button>
            )}
          </div>
          {switchedFrom && !switchToast && mode === switchedFrom.to && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-border bg-brand-soft px-3 py-1.5 text-xs text-ink-secondary">
              <span>
                Switched to {MODE_BY_VALUE[switchedFrom.to]?.label ?? switchedFrom.to} - it
                suits this question better.
              </span>
              {sending ? (
                <button
                  type="button"
                  onClick={() => {
                    // Stop the answer being written and ask the same
                    // question in the mode they had chosen, telling the
                    // server the mode is settled so it doesn't suggest again.
                    handleStop();
                    setMode(switchedFrom.from);
                    const { from, content, images, flags } = switchedFrom;
                    setSwitchedFrom(null);
                    void handleSend(
                      content, images, from, true, flags.contextAcknowledged, flags.contextRounds,
                      undefined, flags.refinedConfirmed, flags.clarifyingConfirmed,
                    );
                  }}
                  className="font-medium text-brand hover:underline"
                >
                  Answer in {MODE_BY_VALUE[switchedFrom.from]?.label ?? switchedFrom.from} instead
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode(switchedFrom.from);
                    setSwitchedFrom(null);
                  }}
                  className="font-medium text-brand hover:underline"
                >
                  Back to {MODE_BY_VALUE[switchedFrom.from]?.label ?? switchedFrom.from}
                </button>
              )}
              <button
                type="button"
                onClick={() => setSwitchedFrom(null)}
                aria-label="Dismiss"
                className="ml-auto rounded px-1 text-ink-muted hover:text-ink"
              >
                ×
              </button>
            </div>
          )}
          <MessageInput
            disabled={!mode || sending}
            disabledReason={
              !mode ? "Select a cognitive mode above to start typing" : undefined
            }
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            onTypingChange={setIsTyping}
            textareaRef={composerRef}
            onStartCall={mode ? () => setCallOpen(true) : undefined}
            isGenerating={sending}
            onStop={handleStop}
          />
        </div>
        <UpgradeDialog open={upsell !== null} trigger={upsell} onClose={() => setUpsell(null)} />
      </div>
    </div>
  );
}
