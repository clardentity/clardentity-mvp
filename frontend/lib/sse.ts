import { API_BASE_URL } from "@/lib/apiClient";
import { getAccessToken, getRefreshToken, refreshAccessToken } from "@/lib/auth";

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
  /** A question the answer wants answered, with options. Null on most turns. */
  clarifier: { question: string; options: string[] } | null;
  guidance: Guidance | null;
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
};

/** Named phase of the work in progress, for the waiting indicator. */
export type ChatStatus = { phase: string; label: string };

export type ChatStreamHandlers = {
  onDelta: (text: string) => void;
  /** The answer is written and saved, but not yet analysed. Fires well before
   *  `onFinal` - claim verification and scoring take several seconds - and is
   *  the point at which the composer should become usable again. */
  onAnswer: (message: ChatMessage) => void;
  /** Named phase of the pipeline, so the wait can say what it's waiting on. */
  onStatus?: (status: ChatStatus) => void;
  onFinal: (event: ChatFinalEvent) => void;
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
};

async function openStream(
  conversationId: string,
  body: SendMessageBody,
): Promise<Response> {
  const accessToken = getAccessToken();
  return fetch(`${API_BASE_URL}/chat/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

export async function streamChatMessage(
  conversationId: string,
  body: SendMessageBody,
  handlers: ChatStreamHandlers,
): Promise<void> {
  let res: Response;
  try {
    res = await openStream(conversationId, body);
  } catch (err) {
    handlers.onError(err instanceof Error ? err.message : "Network error");
    return;
  }

  if (res.status === 401 && getRefreshToken()) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await openStream(conversationId, body);
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
    handlers.onError(detail);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
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
    else if (eventType === "answer") handlers.onAnswer(parsed.message);
    else if (eventType === "status") handlers.onStatus?.(parsed);
    else if (eventType === "final") handlers.onFinal(parsed);
    else if (eventType === "error") handlers.onError(parsed.detail);
  } catch {
    // ignore malformed frame
  }
}
