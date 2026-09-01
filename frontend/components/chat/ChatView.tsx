"use client";

import { useEffect, useRef, useState } from "react";
import { API_BASE_URL, apiFetch } from "@/lib/apiClient";
import { authErrorMessage, getAccessToken } from "@/lib/auth";
import {
  streamChatMessage,
  type ChatMessage,
  type ChatStatus,
  type ModeSuggestion,
} from "@/lib/sse";
import { ModeSelector, type CognitiveMode } from "@/components/chat/ModeSelector";
import { MessageList, type StreamingMessage } from "@/components/chat/MessageList";
import { ModeCarousel, groupByMode } from "@/components/chat/ModeCarousel";
import { MessageInput, type PendingImage } from "@/components/chat/MessageInput";
import { LiveCallOverlay } from "@/components/chat/LiveCallOverlay";
import { ModeSuggestionCard } from "@/components/chat/ModeSuggestionCard";
import { ContextQuestionCard } from "@/components/chat/ContextQuestionCard";
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

const GESTURE_BY_MODE: Record<CognitiveMode, AvatarGesture> = {
  knowing: "presenting",
  thinking: "chin_stroke",
  decision: "weighing_scales",
  learning: "open_hand_explaining",
  mentoring: "open_hand_explaining",
  therapy: "chin_stroke",
  creative: "presenting",
};

export function ChatView({ conversationId }: { conversationId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Distinct from "no messages". Without it, reopening a chat rendered the
  // "Start a chat" empty state for the second or two the fetch took.
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [mode, setMode] = useState<CognitiveMode | null>(null);
  const [streaming, setStreaming] = useState<StreamingMessage | null>(null);
  const [sending, setSending] = useState(false);
  // The message whose claims are still being verified. It is already on
  // screen and already saved; this only drives the "checking claims" note.
  const [validatingId, setValidatingId] = useState<string | null>(null);
  // What the server last said it was doing. Null falls back to the rotating
  // verbs in ThinkingIndicator.
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [avatarCue, setAvatarCue] = useState<AvatarCue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playingMessageId, setPlayingMessageId] = useState<string | null>(null);
  // The composer's text lives here so editing a sent message can put it back.
  const [draft, setDraft] = useState("");
  // Carousel view is opt-out, and only offered once a second mode exists.
  const [carousel, setCarousel] = useState(true);
  const [activeTrack, setActiveTrack] = useState(0);
  const [callOpen, setCallOpen] = useState(false);
  // A pending question the server declined to answer until the mode is
  // settled. Holds the original send so either choice can replay it.
  const [pendingMode, setPendingMode] = useState<{
    suggestion: ModeSuggestion;
    content: string;
    images: PendingImage[];
    mode: CognitiveMode;
  } | null>(null);
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
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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
  ) {
    const sendMode = modeOverride ?? mode;
    if (!sendMode) return;
    setPendingMode(null);
    setPendingContext(null);

    setError(null);
    setSending(true);
    setIsTyping(false);
    setStatus(null);

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
        mode_confirmed: modeConfirmed,
        context_acknowledged: contextAcknowledged,
        context_rounds: contextRounds,
        parent_id: fork?.parentId,
        regenerate_of: fork?.regenerateOf,
      },
      {
        onStatus: setStatus,
        onDelta: (text) => {
          // The first token is the end of waiting; anything the server says
          // it is doing after this belongs to the post-answer phase.
          setStatus(null);
          setStreaming((prev) =>
            prev ? { ...prev, content: prev.content + text } : prev,
          );
        },
        onAnswer: (message) => {
          // The text is written and saved; only the analysis is outstanding.
          // Waiting for that to finish before letting you type again is what
          // made the app feel like it was still working long after it had
          // clearly finished answering.
          setMessages((prev) => [...prev, message]);
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
          setStatus(null);
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
        onModeSuggestion: (suggestion) => {
          // Nothing was written server-side, so the optimistic user message is
          // rolled back too - it will be re-sent for real once they choose.
          // (Regenerating never reaches this - the server skips the mode
          // gate entirely for it - so there's no optimistic message to roll
          // back in that case.)
          if (userMessage) setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
          setPendingMode({ suggestion, content, images, mode: sendMode });
          setStreaming(null);
          setSending(false);
          setStatus(null);
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
          setStatus(null);
        },
        onError: (detail) => {
          setError(detail);
          setStreaming(null);
          setSending(false);
          setValidatingId(null);
          setStatus(null);
        },
      },
    );
  }

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
      await handleSend("", [], target.mode_used as CognitiveMode, true, true, 0, {
        regenerateOf: target.id,
      });
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
      onSwitchBranch={handleSwitchBranch}
      busy={sending}
      statusLabel={status?.label}
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

        {pendingMode && (
          <ModeSuggestionCard
            suggestedMode={pendingMode.suggestion.suggested_mode}
            reason={pendingMode.suggestion.mode_reason}
            currentMode={pendingMode.mode}
            busy={sending}
            onSwitch={() => {
              const next = pendingMode.suggestion.suggested_mode as CognitiveMode;
              setMode(next);
              void handleSend(pendingMode.content, pendingMode.images, next, true);
            }}
            onContinue={() =>
              void handleSend(pendingMode.content, pendingMode.images, pendingMode.mode, true)
            }
          />
        )}

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
                `${pendingContext.content}\n\n(You asked: "${pendingContext.question}")\n${context}`,
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

        {error && (
          <div className="mb-3 rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
            {error}
          </div>
        )}

        <div className="space-y-3 border-t border-hairline py-4">
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
              />
            )}
            {/* flex-1 so the unselected state - which renders all four modes
                as cards - gets the full row instead of shrink-wrapping next
                to the avatar. */}
            <div className="min-w-0 flex-1">
              <ModeSelector value={mode} onChange={setMode} disabled={sending} />
            </div>
          </div>
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
          />
        </div>
      </div>
    </div>
  );
}
