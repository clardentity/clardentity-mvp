import { API_BASE_URL } from "@/lib/apiClient";
import { getAccessToken, networkErrorMessage, getRefreshToken, refreshAccessToken } from "@/lib/auth";

export type Evidence = {
  citation_marker: number;
  /** Null for a web source; `document_filename` then holds the page title. */
  document_id: string | null;
  document_filename: string;
  excerpt: string;
  support_score: number | null;
  relevance_score: number | null;
  entailment_label: string | null;
  source_type: "document" | "web";
  url: string | null;
  /** The supervisor's 0-1 verdict on the source, and one line of reasoning. */
  credibility_score: number | null;
  credibility_note: string | null;
};

export type Claim = {
  claim_index: number;
  claim_text: string;
  claim_score: number | null;
  entailment_label: string | null;
  /** Taxonomy id of the detected cognitive bias, if any. The display name and
   *  definition travel alongside it so the client never needs the catalogue. */
  distortion_flag: string | null;
  distortion_explanation: string | null;
  bias_name: string | null;
  bias_definition: string | null;
  bias_category: string | null;
  bias_category_name: string | null;
  /** Set only when this claim landed in gray_area and got a second, blind
   *  reconciliation pass. `dynamic` means that pass judged it genuinely
   *  developing rather than simply hard to verify - there is no scheduled
   *  re-check behind it, just a signal the tier is provisional. */
  reconciliation_note: string | null;
  dynamic: boolean;
  evidence: Evidence[];
};

/** Suggestions about the question rather than answers to it: a mode that
 *  would have suited it better, and a sharper phrasing. Both halves are
 *  independently nullable and are null on most turns by design. */
export type Guidance = {
  suggested_mode: string | null;
  mode_reason: string | null;
  refined_question: string | null;
  refinement_reason: string | null;
};

/** Per-option verdicts on options the user listed in decision mode, plus an
 *  alternative when every one of them is compromised. Null on most turns. */
export type DecisionReviewData = {
  options: {
    label: string;
    sound: boolean;
    bias_name: string | null;
    bias_definition: string | null;
    why: string;
  }[];
  alternative: string | null;
  alternative_why: string | null;
  /** Decisions worth considering, best first - present whether or not the
   *  user listed options of their own. */
  /** A teaching set: exactly one sound decision and the rest distorted, each
   *  with the reasoning error that makes it wrong. The server drops the whole
   *  set unless that shape holds. */
  suggestions: {
    decision: string;
    why: string;
    sound: boolean;
    bias_name: string | null;
    bias_definition: string | null;
  }[];
};

/** Thinking mode's replacement for claims and evidence: the reasoning that
 *  holds for the question against the way it most easily goes wrong. */
export type ThinkingReviewData = {
  sound: { approach: string; why: string }[];
  biased: { approach: string; bias_name: string | null; bias_definition: string | null; why: string }[];
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string | null;
  mode_used: string;
  reasoning_lens: string | null;
  confidence_score: number | null;
  confidence_band: string | null;
  avatar_expression: string | null;
  avatar_gesture: string | null;
  created_at: string;
  /** The Devil's Draft, generated alongside the answer rather than on click. */
  counterfactual_content: string | null;
  /** The model's own one-sentence bottom line, shown above the folded
   *  answer. Null for messages generated before this shipped. */
  crux_text: string | null;
  /** A question the answer wants answered, with options. Null on most turns. */
  clarifier: { question: string; options: string[] } | null;
  guidance: Guidance | null;
  decision_review: DecisionReviewData | null;
  thinking_review: ThinkingReviewData | null;
  /** The user's own reaction to this answer - null until they tap something. */
  feedback: { rating: "up" | "down" | null; comment: string | null } | null;
  /** Null for the very first message(s) of a conversation. */
  parent_id: string | null;
  /** This message's position among its siblings (0-based) and how many
   *  there are - the fork switcher's "< 2/3 >". 1 sibling means there's
   *  nothing to switch between, which is most messages. */
  sibling_index: number;
  sibling_count: number;
  /** Every sibling's id, oldest first (this message's included) - what the
   *  fork switcher's arrows navigate between via PUT .../active-leaf. */
  sibling_ids: string[];
  claims: Claim[];
};

export type ChatFinalEvent = {
  message: ChatMessage;
  claims: Claim[];
  confidence: { score: number; band: string } | null;
  avatar_cue: { expression: string; gesture: string } | null;
  counterfactual_content: string | null;
  /** What the search agent tried, when it came back empty-handed. */
  research_notes: string[];
  /** Set on a conversation's first turn once it has been named from the
   *  exchange (a few words about the subject, replacing the placeholder cut
   *  from the question). Null when nothing changed. */
  conversation_title?: string | null;
};

/** The server stopped before generating because a different mode suits the
 *  question better. Nothing was saved; the turn is exactly where it was. */
export type ModeSuggestion = { suggested_mode: string; mode_reason: string | null };

/** The server stopped before generating because the message is about the
 *  user's own life and the reasons behind it were not given. One open
 *  question, no options - a menu would be grotesque on "why do you want to
 *  divorce your wife". Nothing was saved. */
export type ContextQuestion = { question: string };

/** The server stopped before generating because the question is vague
 *  enough that answering it well required guessing. A single suggested
 *  rewording, not a menu - accept it or keep the original. Nothing was
 *  saved. */
export type RefinedQuestionSuggestion = {
  refined_question: string;
  refinement_reason: string | null;
};

/** The server stopped before generating because one specific piece of
 *  information is missing and there's a short, enumerable set of likely
 *  answers - a question plus 2-4 tappable options, not a rewording or an
 *  open text box. Nothing was saved. */
export type ClarifyingOptionsSuggestion = {
  question: string;
  options: string[];
};

/** Named phase of the work in progress, for the waiting indicator. */
export type ChatStatus = { phase: string; label: string };

export type ChatStreamHandlers = {
  onDelta: (text: string) => void;
  /** The model's leading one-sentence bottom line, sent the moment it's
   *  complete - before any body text - so it can be shown first. */
  onCrux?: (text: string) => void;
  /** The answer is written and saved, but not yet analysed. Fires well before
   *  `onFinal` - claim verification and scoring take several seconds - and is
   *  the point at which the composer should become usable again.
   *
   *  `userMessage` is the just-persisted row for the question this answers,
   *  with its real server id - the caller's own optimistic copy of it was
   *  built before that id existed and needs to be swapped for this one to
   *  ever address the row again (e.g. to delete it). Absent on regenerate,
   *  which never created a new question row to begin with. */
  onAnswer: (message: ChatMessage, userMessage?: ChatMessage | null) => void;
  /** Named phase of the pipeline, so the wait can say what it's waiting on. */
  onStatus?: (status: ChatStatus) => void;
  onFinal: (event: ChatFinalEvent) => void;
  /** Fires *instead of* everything else: no answer was generated and nothing
   *  was written. The caller re-sends once the user has chosen. */
  onModeSuggestion?: (suggestion: ModeSuggestion) => void;
  /** Also fires instead of everything else. The caller re-sends with the
   *  user's context appended, or with `context_acknowledged` alone if they
   *  would rather just have the answer. */
  onContextQuestion?: (question: ContextQuestion) => void;
  /** Also fires instead of everything else. The caller re-sends with either
   *  the refined wording or the original, and `refined_confirmed: true`
   *  either way. */
  onRefinedQuestion?: (suggestion: RefinedQuestionSuggestion) => void;
  /** Also fires instead of everything else. The caller re-sends with a
   *  tapped option, a typed answer, or `clarifying_confirmed: true` alone
   *  if they'd rather skip it. */
  onClarifyingOptions?: (suggestion: ClarifyingOptionsSuggestion) => void;
  onError: (detail: string) => void;
};

export type SendMessageAttachment = {
  type: "image";
  data: string;
  mime_type: string;
};

export type SendMessageBody = {
  content: string;
  mode: string;
  reasoning_lens?: string | null;
  attachments?: SendMessageAttachment[];
  audio_duration_seconds?: number | null;
  /** Set when re-sending after a mode suggestion, either way the user
   *  answered, so the same question is never stopped twice. */
  mode_confirmed?: boolean;
  /** Set when re-sending after explicitly skipping the pre-answer "why" (the
   *  "Answer without this" option) - a hard stop regardless of round count. */
  context_acknowledged?: boolean;
  /** How many context-gate rounds have already been answered for this turn.
   *  The server caps further asking once this hits its limit. */
  context_rounds?: number;
  /** Set when re-sending after a refined-phrasing suggestion, either way the
   *  user answered, so the same suggestion is never stopped twice. */
  refined_confirmed?: boolean;
  /** Set when re-sending after a clarifying-options prompt, whichever way
   *  the user answered it, so the same prompt is never stopped twice. */
  clarifying_confirmed?: boolean;
  /** Fork point for the new user message this call creates. Set when
   *  editing, to the edited message's own parent_id, so the edit becomes a
   *  sibling instead of the server treating it as a normal continuation. */
  parent_id?: string | null;
  /** Set instead of real content to regenerate: produces an alternate answer
   *  to this existing assistant message, as its sibling. `content`/`mode`
   *  are ignored server-side when this is set. */
  regenerate_of?: string;
};

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function openStream(
  conversationId: string,
  body: SendMessageBody,
  signal?: AbortSignal,
): Promise<Response> {
  const accessToken = getAccessToken();
  return fetch(`${API_BASE_URL}/chat/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
}

export async function streamChatMessage(
  conversationId: string,
  body: SendMessageBody,
  handlers: ChatStreamHandlers,
  // A user-initiated stop, not a failure: resolves quietly with no handler
  // call, since the caller already knows it asked for this and updates its
  // own UI immediately rather than waiting for a round trip through here.
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await openStream(conversationId, body, signal);
  } catch (err) {
    if (isAbortError(err)) return;
    handlers.onError(
      networkErrorMessage(err) ?? (err instanceof Error ? err.message : "Network error"),
    );
    return;
  }

  if (res.status === 401 && getRefreshToken()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      try {
        res = await openStream(conversationId, body, signal);
      } catch (err) {
        if (isAbortError(err)) return;
        handlers.onError(
          networkErrorMessage(err) ?? (err instanceof Error ? err.message : "Network error"),
        );
        return;
      }
    }
  }

  if (!res.ok || !res.body) {
    let detail = `Request failed with status ${res.status}`;
    try {
      const errBody = await res.json();
      detail = errBody.detail ?? detail;
    } catch {
      // no JSON body
    }
    // Still 401 after the refresh above was tried: the session really is
    // over (a token past its 30 days, or revoked by a password reset). Say
    // that, in words - the server's "Not authenticated" read as a bug.
    if (res.status === 401) detail = "Your session has expired. Please sign in again.";
    handlers.onError(detail);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    let value: Uint8Array | undefined;
    let done: boolean;
    try {
      ({ value, done } = await reader.read());
    } catch (err) {
      if (isAbortError(err)) return;
      throw err;
    }
    if (done) break;
    // sse-starlette terminates lines/records with \r\n, not \n - normalize
    // before splitting so frame boundaries actually match.
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      handleRawEvent(rawEvent, handlers);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function handleRawEvent(raw: string, handlers: ChatStreamHandlers) {
  let eventType = "message";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }
  if (!data) return;

  try {
    const parsed = JSON.parse(data);
    if (eventType === "delta") handlers.onDelta(parsed.text);
    else if (eventType === "crux") handlers.onCrux?.(parsed.text);
    else if (eventType === "answer") handlers.onAnswer(parsed.message, parsed.user_message);
    else if (eventType === "status") handlers.onStatus?.(parsed);
    else if (eventType === "final") handlers.onFinal(parsed);
    else if (eventType === "mode_suggestion") handlers.onModeSuggestion?.(parsed);
    else if (eventType === "clarifying_options") handlers.onClarifyingOptions?.(parsed);
    else if (eventType === "context_question") handlers.onContextQuestion?.(parsed);
    else if (eventType === "refined_question") handlers.onRefinedQuestion?.(parsed);
    else if (eventType === "error") handlers.onError(parsed.detail);
  } catch {
    // ignore malformed frame
  }
}
