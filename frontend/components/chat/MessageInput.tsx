"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { autocorrectSupported, fixAtBoundary, loadSpeller, type Fix, type Speller } from "@/lib/autocorrect";
import { apiFetch } from "@/lib/apiClient";
import { AudioRecorder } from "@/components/upload/AudioRecorder";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { cx } from "@/components/ui/primitives";

/** Something the next message carries. An image goes to the model as
 *  vision context; a document is read on the server and its text put in
 *  front of the model (and into the workspace for later questions). */
export type PendingAttachment = {
  kind: "image" | "document";
  data: string;
  mimeType: string;
  filename: string;
  /** Images only. */
  previewUrl?: string;
};

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
/** Mirrors SUPPORTED_TYPES / LEGACY_TYPES in the backend's document_ingestion. */
export const DOCUMENT_EXTENSIONS = [
  "pdf", "docx", "xlsx", "xlsm", "pptx", "txt", "md", "markdown", "csv", "tsv",
  "json", "xml", "html", "htm", "rtf", "log", "yaml", "yml",
];
const LEGACY_EXTENSIONS: Record<string, string> = { doc: "docx", xls: "xlsx", ppt: "pptx" };
export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(",");

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Why a file can't be attached, or null when it can. */
export function attachmentProblem(file: File): string | null {
  if (file.type.startsWith("image/")) {
    return file.size > MAX_IMAGE_BYTES ? "Images must be under 5MB" : null;
  }
  const ext = fileExtension(file.name);
  if (LEGACY_EXTENSIONS[ext]) {
    return `.${ext} is the old binary format - save it as .${LEGACY_EXTENSIONS[ext]} and attach that`;
  }
  if (!DOCUMENT_EXTENSIONS.includes(ext)) {
    return "That file type isn't supported. Use PDF, Word, Excel, PowerPoint, images, or a text file";
  }
  return file.size > MAX_DOCUMENT_BYTES ? "Documents must be under 25MB" : null;
}

function StopIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="h-3.5 w-3.5"
    >
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

/** The text is controlled by the parent rather than held here, because editing
 *  a sent message has to put that message back in the box. Pushing text into a
 *  child that owns it means an effect that writes state on every change - the
 *  parent owning it makes the same feature a plain assignment. */
export function MessageInput({
  disabled,
  disabledReason,
  value,
  onChange,
  onSend,
  onTypingChange,
  textareaRef,
  onStartCall,
  isGenerating,
  onStop,
}: {
  disabled: boolean;
  disabledReason?: string;
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string, attachments: PendingAttachment[]) => void;
  onTypingChange?: (isTyping: boolean) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  /** Owned by the conversation, not the composer: a finished call has to be
   *  saved into the thread, and the composer doesn't know which thread. */
  onStartCall?: () => void;
  /** True while an answer is being generated - swaps the send button for a
   *  stop control instead of just greying it out, so cutting a slow or
   *  unwanted answer off doesn't mean waiting it out. */
  isGenerating?: boolean;
  onStop?: () => void;
}) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fallbackTextareaRef = useRef<HTMLTextAreaElement>(null);
  const taRef = textareaRef ?? fallbackTextareaRef;

  /* Autocorrect - see lib/autocorrect. The dictionaries load the first
     time the box is focused, so a page that never types pays nothing. The
     last correction is kept so it can be undone: by the chip under the
     box, or by Backspace straight after (the phone-keyboard gesture),
     either of which also stops that word being corrected again in this
     session. The caret has to be put back by hand after a replacement,
     since setting a controlled textarea's value throws it to the end. */
  const spellerRef = useRef<Speller | null>(null);
  const ignoreRef = useRef<Set<string>>(new Set());
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const pendingCaretRef = useRef<number | null>(null);
  /* Inline completion - the grey words ahead of the caret. After a pause
     in typing (and only with the caret at the end, three words or more, and
     nothing being sent) the composer asks POST /compose/complete for the
     next few words and shows them as ghost text in a mirror layer behind
     the transparent textarea. Shift takes them; typing on discards them,
     except that typing exactly what was suggested keeps the rest of the
     suggestion in place. Stale replies are dropped by comparing the text
     the request was made for with the text now. */
  const [ghost, setGhost] = useState<{ forText: string; text: string } | null>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const completionSeq = useRef(0);

  useEffect(() => {
    const trimmed = value.trimEnd();
    const el = taRef.current;
    const caretAtEnd = !el || el.selectionStart === value.length;
    if (
      disabled ||
      isGenerating ||
      !caretAtEnd ||
      trimmed.split(/\s+/).filter(Boolean).length < 3 ||
      value.length > 1500
    ) {
      return;
    }
    // A suggestion already fitted to this text needs no new request.
    if (ghost && value.startsWith(ghost.forText)) return;
    const seq = ++completionSeq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch<{ completion: string }>("/compose/complete", {
          method: "POST",
          body: { text: value },
        });
        if (seq !== completionSeq.current || !res.completion) return;
        setGhost({ forText: value, text: res.completion });
      } catch {
        // No suggestion is the normal failure mode.
      }
    }, 650);
    return () => clearTimeout(timer);
  }, [value, disabled, isGenerating, taRef, ghost]);

  // What is still left to show: the suggestion minus whatever of it has
  // since been typed. Null once the text diverges from it.
  const ghostVisible = (() => {
    if (!ghost || !value.startsWith(ghost.forText)) return null;
    const typedBeyond = value.slice(ghost.forText.length);
    if (!ghost.text.startsWith(typedBeyond)) return null;
    const rest = ghost.text.slice(typedBeyond.length);
    return rest.length > 0 ? rest : null;
  })();

  function acceptGhost() {
    if (!ghostVisible) return;
    const next = value + ghostVisible;
    setGhost(null);
    pendingCaretRef.current = next.length;
    onChange(next);
    onTypingChange?.(true);
  }

  useEffect(() => {
    const el = taRef.current;
    if (!el || !autocorrectSupported()) return;
    let cancelled = false;
    function warm() {
      void loadSpeller().then((sp) => {
        if (!cancelled) spellerRef.current = sp;
      });
    }
    el.addEventListener("focus", warm, { once: true });
    return () => {
      cancelled = true;
      el.removeEventListener("focus", warm);
    };
  }, [taRef]);

  useEffect(() => {
    const pos = pendingCaretRef.current;
    if (pos === null) return;
    pendingCaretRef.current = null;
    taRef.current?.setSelectionRange(pos, pos);
  }, [value, taRef]);

  function handleChange(newValue: string) {
    const speller = spellerRef.current;
    const el = taRef.current;
    if (speller && el && newValue.length > value.length) {
      const caret = el.selectionStart ?? newValue.length;
      const fix = fixAtBoundary(newValue, caret, speller, ignoreRef.current);
      if (fix) {
        pendingCaretRef.current = fix.caret;
        setLastFix(fix);
        onChange(fix.text);
        onTypingChange?.(true);
        return;
      }
    }
    if (lastFix && newValue !== lastFix.text) setLastFix(null);
    onChange(newValue);
    onTypingChange?.(newValue.trim().length > 0);
  }

  function undoFix() {
    if (!lastFix) return;
    const { text, from, to, start, caret } = lastFix;
    // Only if the corrected word is still there where it was put.
    if (text.slice(start, start + to.length) !== to || value !== text) {
      setLastFix(null);
      return;
    }
    ignoreRef.current.add(from.toLowerCase());
    const restored = text.slice(0, start) + from + text.slice(start + to.length);
    pendingCaretRef.current = caret - (to.length - from.length);
    setLastFix(null);
    onChange(restored);
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, attachments);
    onChange("");
    setAttachments([]);
    onTypingChange?.(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }
    // Shift on its own takes the grey suggestion (the client's chosen key;
    // Shift+letter still types a capital). Escape drops it.
    if (e.key === "Shift" && !e.repeat && ghostVisible) {
      e.preventDefault();
      acceptGhost();
      return;
    }
    if (e.key === "Escape" && ghostVisible) {
      setGhost(null);
      return;
    }
    // Backspace right after a correction puts the original back instead
    // of deleting the boundary character - the gesture every phone taught.
    if (e.key === "Backspace" && lastFix && value === lastFix.text) {
      const caret = e.currentTarget.selectionStart;
      if (caret === lastFix.caret) {
        e.preventDefault();
        undoFix();
      }
    }
  }

  async function handleFilesSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;

    setAttachError(null);
    for (const file of files) {
      const problem = attachmentProblem(file);
      if (problem) {
        setAttachError(problem);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const base64 = dataUrl.split(",")[1] ?? "";
      const isImage = file.type.startsWith("image/");
      setAttachments((prev) => [
        ...prev,
        isImage
          ? { kind: "image", data: base64, mimeType: file.type, filename: file.name, previewUrl: dataUrl }
          : { kind: "document", data: base64, mimeType: file.type || "application/octet-stream", filename: file.name },
      ]);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-1">
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((item, i) => (
            <div key={i} className="relative">
              {item.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.previewUrl}
                  alt="Attached"
                  className="h-14 w-14 rounded-md border border-hairline-strong object-cover"
                />
              ) : (
                <div
                  className="flex h-14 max-w-[220px] items-center gap-2 rounded-md border border-hairline-strong bg-surface-muted px-2.5 text-xs text-ink-secondary"
                  title={item.filename}
                >
                  <span className="rounded bg-surface px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-muted">
                    {fileExtension(item.filename) || "file"}
                  </span>
                  <span className="truncate">{item.filename}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[9px] text-surface transition-opacity hover:opacity-80"
                aria-label={`Remove ${item.kind === "image" ? "image" : item.filename}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {attachError && <p className="text-xs text-band-low">{attachError}</p>}

      {/* No focus treatment on the composer. It is the one control on the
          page whose whole purpose is to be typed into, so ringing it in the
          accent colour every time the caret lands there was decoration that
          fired constantly and told you nothing you didn't already know. The
          caret is the indicator. */}
      <div
        data-tour="composer"
        className="flex flex-col gap-1.5 rounded-xl border border-hairline-strong bg-surface-raised p-2 sm:flex-row sm:items-end sm:gap-2"
      >
        {/* On a phone the five controls and the textarea competed for one
            390px row, and the textarea lost - "Ask a question..." wrapped
            onto three lines inside a box two words wide. Stacked, the
            textarea gets the full width and the controls get their own row
            underneath. `sm:contents` dissolves this wrapper from the small
            breakpoint up, so the desktop layout is still one flat flex row
            rather than a nested one that would align differently. */}
        <div className="order-2 flex items-center gap-1 sm:contents">
          <ModelPicker disabled={disabled} />

          <AudioRecorder
            disabled={disabled}
            onTranscribed={(text) => handleChange((value ? value + " " : "") + text)}
          />

        {/* Next to the mic, because they are the same intention at two
            lengths: dictate one message, or have a conversation. */}
        <button
          type="button"
          data-tour="live-call"
          onClick={onStartCall}
          disabled={disabled || !onStartCall}
          title="Start a live call"
          aria-label="Start a live call"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            {/* A waveform inside a call bubble: speech, live. */}
            <path d="M21 15.5v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 1.1 2.8 2 2 0 0 1 3.1 1h3a2 2 0 0 1 2 1.7c.1 1 .3 1.9.7 2.8a2 2 0 0 1-.5 2.1L7.1 8.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
            <path d="M16 3v4M19.5 1.5v7M13 4.5v1" />
          </svg>
        </button>

        <button
          type="button"
          data-tour="attach-image"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach a file or image"
          aria-label="Attach a file or image"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className="h-4 w-4"
          >
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
          </svg>
        </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={`image/*,${DOCUMENT_ACCEPT}`}
            multiple
            onChange={handleFilesSelected}
            className="hidden"
          />


          {/* Pushed to the right edge of the control row on mobile; on
              desktop `sm:contents` has removed this wrapper, so the margin
              would misalign it against the textarea - hence sm:ml-0.

              While generating this becomes a stop control rather than a
              disabled "Ask" - the answer might be slow, wrong-mode, or just
              no longer wanted, and waiting it out was the only option
              before. */}
          <button
            type="button"
            data-tour="ask-button"
            onClick={isGenerating ? onStop : handleSend}
            disabled={isGenerating ? !onStop : disabled || !value.trim()}
            className={cx(
              "ml-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:order-last sm:ml-0",
              isGenerating
                ? "bg-surface-sunken text-ink hover:bg-surface-hover"
                : "bg-brand text-white hover:bg-brand-dark",
            )}
          >
            {isGenerating ? (
              <>
                <StopIcon />
                Stop
              </>
            ) : (
              // "Ask", not "Send". Send is what you do to a message; this is
              // a product where every mode is framed as a question and the
              // whole value is in the answer coming back. "Submit" is form
              // language - it belongs on a tax return.
              "Ask"
            )}
          </button>
        </div>

        <div className="relative order-1 w-full flex-1">
          {/* The ghost layer: the typed text invisibly, so the suggestion
              lands exactly where the caret is, then the suggestion in grey.
              Same box, font and padding as the textarea; scroll kept in
              step; never in the way of the pointer. */}
          {ghostVisible && (
            <div
              ref={mirrorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1 py-2 text-sm leading-relaxed"
            >
              <span className="invisible">{value}</span>
              <span className="text-ink-muted">{ghostVisible}</span>
            </div>
          )}
        <textarea
          ref={taRef}
          onScroll={(e) => {
            if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
          data-tour="composer-input"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={disabled}
          // Explicit, not left to the browser default: the built-in spelling
          // and (in Chromium/Safari) grammar check is the free Grammarly tier
          // people asked for, and it only runs when the field opts in.
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
          placeholder={
            disabled
              ? disabledReason ?? "Select a mode to start typing"
              : "Ask a question…"
          }
          className="relative w-full resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
        />
        </div>
      </div>
      {disabled && disabledReason && (
        <p className="text-xs text-ink-muted">{disabledReason}</p>
      )}
      {/* The keyboard hint left the placeholder, where it cost two of the
          three visible lines on a phone to explain a chord that phone has no
          way to type. Kept for pointer devices, where it is discoverable and
          free. */}
      {ghostVisible ? (
        <p className="flex items-center gap-2 text-[11px] text-ink-muted" aria-live="polite">
          <span className="truncate">
            Suggestion: <span className="text-ink-secondary">{ghostVisible.trim()}</span>
          </span>
          <button
            type="button"
            onClick={acceptGhost}
            className="shrink-0 rounded border border-hairline px-1.5 py-0.5 font-medium text-brand transition-colors hover:bg-surface-hover"
          >
            <kbd className="font-sans">Shift</kbd> to complete
          </button>
        </p>
      ) : lastFix && value === lastFix.text ? (
        <p className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span>
            Corrected <s className="text-ink-muted/70">{lastFix.from}</s> to{" "}
            <span className="font-medium text-ink-secondary">{lastFix.to}</span>
          </span>
          <button
            type="button"
            onClick={undoFix}
            className="font-medium text-brand hover:underline"
          >
            Undo
          </button>
        </p>
      ) : (
        !disabled && (
          <p className="hidden text-[11px] text-ink-muted sm:block">
            Enter to ask, Shift+Enter for a new line
          </p>
        )
      )}
    </div>
  );
}
