"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { autocorrectSupported, fixAtBoundary, loadSpeller, type Fix, type Speller } from "@/lib/autocorrect";
import { apiFetch } from "@/lib/apiClient";
import { AudioRecorder } from "@/components/upload/AudioRecorder";
import { VendorModelPicker } from "@/components/chat/VendorModelPicker";
import { PICKABLE_MODES } from "@/lib/pickableModels";
import { MaskIcon } from "@/components/ui/MaskIcon";
import { cx } from "@/components/ui/primitives";
import { useTouchKeyboard } from "@/lib/useTouchKeyboard";
import { usePhoneLayout } from "@/lib/usePhoneLayout";
import { track } from "@/lib/analytics";

/** Tallest the composer's textarea grows before it scrolls: about five lines. */
const COMPOSER_MAX_HEIGHT = 120;

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
  trailing,
  mode,
  isGenerating,
  onStop,
  gated,
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
  /** Rendered in the foot of the card, beside the model chip. The design puts
   *  the controls that describe *how* the answer is produced there, which is
   *  where switching belongs now that the rail spans the full width. */
  trailing?: ReactNode;
  /** Which companion is selected. Only used to decide whether a model
   *  picker belongs here at all: Co-Creative names the models; every other
   *  mode has none (the capability tiers are plans, under Upgrade in the
   *  account menu). */
  mode?: string | null;
  /** True while an answer is being generated - swaps the send button for a
   *  stop control instead of just greying it out, so cutting a slow or
   *  unwanted answer off doesn't mean waiting it out. */
  isGenerating?: boolean;
  onStop?: () => void;
  /** Set only by the landing page's guest demo, which shows this composer to
   *  someone who has no account. Attaching a file, dictating and choosing a
   *  model all need one, so each control stays exactly where it is and calls
   *  this instead of doing its job - the row is the product's own, and the
   *  answer to pressing one is an invitation rather than a dead button. The
   *  call button needs nothing here: it already does whatever `onStartCall`
   *  says, and the demo passes an invitation. */
  gated?: (feature: "attach" | "voice" | "model") => void;
}) {
  const touchKeyboard = useTouchKeyboard();
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
      // The completion endpoint needs an account, so for a guest this is a
      // 401 every time they pause typing - on a public landing page, from a
      // feature that could never show them anything.
      gated ||
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
  }, [value, disabled, isGenerating, gated, taRef, ghost]);

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
    track("completion_accepted", { words: ghostVisible.trim().split(/\s+/).length });
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

  // Phone layout only: grows with what's typed, up to about five lines, then
  // scrolls inside. Desktop keeps the drawn one-row box.
  // It used to stay one row tall whatever the length: a paragraph on a phone
  // was read through a one-line slot. Measured before paint so the box never
  // flashes at the old height; the cap keeps the thread above in view.
  const phoneLayout = usePhoneLayout();
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    if (!phoneLayout) {
      el.style.height = "";
      el.style.overflowY = "";
      return;
    }
    el.style.height = "auto";
    const capped = Math.min(el.scrollHeight, COMPOSER_MAX_HEIGHT);
    el.style.height = `${capped}px`;
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT ? "auto" : "hidden";
  }, [value, taRef, phoneLayout]);

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
    // On a phone or tablet Enter is the new-line key it is everywhere else,
    // and Ask is the only way to send: there is no Shift to hold, and
    // sending on Enter meant half-written questions went out and a second
    // paragraph could not be typed at all.
    if (e.key === "Enter" && !e.shiftKey && !touchKeyboard) {
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
      track("attachment_added", {
        kind: isImage ? "image" : "document",
        extension: isImage ? undefined : fileExtension(file.name),
        size_kb: Math.round(file.size / 1024),
      });
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
    <div data-composer className="space-y-1">
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
                  <span className="rounded bg-surface px-1 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    {fileExtension(item.filename) || "file"}
                  </span>
                  <span className="truncate">{item.filename}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => removeAttachment(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-xs text-surface transition-opacity hover:opacity-80"
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
        // The design's composer: one tall white card, 20px radius, a hairline
        // and a shadow stacked from five barely-there layers, with the
        // question on top and the controls along the foot. Not a row - the
        // text gets the full width at every size, which is what the old
        // side-by-side arrangement could not give it on a phone.
        className="flex min-h-[124px] flex-col rounded-[20px] max-lg:min-h-0 border border-[color:var(--border)] bg-surface-raised p-0 shadow-[0px_697px_195px_0px_rgba(0,0,0,0),0px_446px_178px_0px_rgba(0,0,0,0.01),0px_251px_150px_0px_rgba(0,0,0,0.03),0px_111px_111px_0px_rgba(0,0,0,0.04),0px_28px_61px_0px_rgba(0,0,0,0.05)]"
      >
        {/* On a phone the five controls and the textarea competed for one
            390px row, and the textarea lost - "Ask a question..." wrapped
            onto three lines inside a box two words wide. Stacked, the
            textarea gets the full width and the controls get their own row
            underneath. `sm:contents` dissolves this wrapper from the small
            breakpoint up, so the desktop layout is still one flat flex row
            rather than a nested one that would align differently. */}
        {/* The foot of the card, as drawn: the paperclip alone on the left,
            and on the right the chip that says how the answer is made, then
            the voice controls, then the send disc. Everything in it is 32px
            tall so the whole row centres 31px above the card's bottom edge,
            which is where the design puts it. */}
        {/* Phone: tighter, so the box is about two-thirds the height - the
            buttons keep a 44px reach through tap areas (globals.css) and are
            spaced so those areas don't overlap. */}
        <div className="order-2 flex items-center px-[27px] pb-[15px] max-lg:pb-2 max-lg:pl-3.5 max-lg:pr-3 max-lg:pt-2.5">
          <button
            type="button"
            data-tour="attach-image"
            onClick={() => (gated ? gated("attach") : fileInputRef.current?.click())}
            disabled={disabled}
            title="Attach a file or image"
            aria-label="Attach a file or image"
            className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MaskIcon src="/ui/composer-paperclip.svg" className="size-5" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={`image/*,${DOCUMENT_ACCEPT}`}
            multiple
            onChange={handleFilesSelected}
            className="hidden"
          />

          <div className="ml-auto flex min-w-0 items-center gap-1 max-lg:gap-4">
            {mode && PICKABLE_MODES.has(mode) ? (
              gated ? (
                // The chip, without the menu behind it. Same shape and the
                // same place, so the foot of the card reads as it does in
                // the app.
                <button
                  type="button"
                  onClick={() => gated("model")}
                  title="Choose which model answers in this mode"
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-sm text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  <span>Auto</span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-3.5">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              ) : (
                // The one mode where the user picks the model by name.
                <VendorModelPicker mode={mode} disabled={disabled} />
              )
            ) : null}
            {trailing}

            {/* Next to the mic, because they are the same intention at two
                lengths: dictate one message, or have a conversation. */}
            <button
              type="button"
              data-tour="live-call"
              onClick={() => {
                track("call_started");
                onStartCall?.();
              }}
              disabled={disabled || !onStartCall}
              title="Start a live call"
              aria-label="Start a live call"
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
            >
              {/* The dialpad. It was drawn for the composer's empty send
                  button, where a grid of keys next to a text box meant
                  nothing - but a keypad is what you press to place a call,
                  and this is the button that places one. The waveform it
                  replaces said "audio" without saying what would happen.
                  (The handset before that was worse: a picture of an object
                  most people asking for this have never held.) */}
              <MaskIcon src="/ui/composer-dialpad.svg" className="size-5" />
            </button>

            {gated ? (
              // The recorder's idle face, button for button. It never starts
              // a recording, so it never asks for the microphone either -
              // a permission prompt for a feature that cannot run would be
              // the rudest possible way to ask someone to sign up.
              <button
                type="button"
                onClick={() => gated("voice")}
                title="Record a voice message"
                aria-label="Record a voice message"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="h-5 w-5"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
                </svg>
              </button>
            ) : (
              <AudioRecorder
                disabled={disabled}
                onTranscribed={(text) => {
                  track("voice_recorded", { words: text.trim().split(/\s+/).length });
                  handleChange((value ? value + " " : "") + text);
                }}
              />
            )}

            {/* While generating this becomes a stop control rather than a
                disabled "Ask" - the answer might be slow, wrong-mode, or just
                no longer wanted, and waiting it out was the only option
                before. */}
            <button
              type="button"
              data-tour="ask-button"
              onClick={isGenerating ? onStop : handleSend}
              disabled={isGenerating ? !onStop : disabled || !value.trim()}
              // A 32px burgundy disc at the end of the row, as drawn. It keeps
              // its accessible name - the circle alone says nothing to a screen
              // reader - and still becomes a stop control mid-answer.
              aria-label={isGenerating ? "Stop generating" : "Ask"}
              className={cx(
                "-mr-[5px] flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed max-lg:size-9",
                isGenerating
                  ? "bg-surface-sunken text-ink hover:bg-surface-hover"
                  : // Grey while there is nothing to send. It was a full
                    // burgundy disc whether or not it would do anything,
                    // so the one control that is supposed to say "ready"
                    // looked identical when it was not.
                    "bg-brand text-white hover:bg-brand-dark disabled:bg-surface-sunken disabled:text-ink-muted disabled:hover:bg-surface-sunken",
              )}
            >
              {isGenerating ? (
                <StopIcon />
              ) : (
                // One face now. The design drew two - a keypad while the box
                // was empty, an arrow once it wasn't - but the keypad has
                // gone to the call button, where it means something. An
                // arrow that greys out says the same thing the swap did,
                // without the glyph changing under the reader's eye.
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  className="block size-5"
                >
                  <path d="M10 16V4.5M4.6 9.9 10 4.5l5.4 5.4" />
                </svg>
              )}
            </button>
          </div>
        </div>

        <div className="relative order-1 w-full flex-1 px-[27px] pt-[26px] max-lg:px-4 max-lg:pt-3.5">
          {/* The ghost layer: the typed text invisibly, so the suggestion
              lands exactly where the caret is, then the suggestion in grey.
              Same box, font and padding as the textarea; scroll kept in
              step; never in the way of the pointer. */}
          {ghostVisible && (
            <div
              ref={mirrorRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-[27px] pt-[26px] text-xl leading-[normal] max-lg:px-4 max-lg:pt-3.5 max-lg:text-lg"
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
          // One row, not two: the card's own 124px floor is what gives the
          // box its height, and asking for a second row made it taller than
          // the design before a word was typed.
          rows={1}
          disabled={disabled}
          // Explicit, not left to the browser default: the built-in spelling
          // and (in Chromium/Safari) grammar check is the free Grammarly tier
          // people asked for, and it only runs when the field opts in.
          spellCheck
          autoCorrect="on"
          autoCapitalize="sentences"
          placeholder={
            // The fallback is deliberately neutral. It used to be "Select a
            // mode to start typing", which is true of exactly one of the
            // reasons this box gets disabled and actively wrong about the
            // others - a caller that disabled it mid-answer got an
            // instruction the user had already followed.
            disabled ? disabledReason ?? "One moment…" : "Ask a question…"
          }
          title={
            touchKeyboard
              ? "Enter starts a new line - tap the arrow to send"
              : "Enter to ask, Shift+Enter for a new line"
          }
          className="relative w-full resize-none bg-transparent p-0 text-xl leading-[normal] max-lg:text-lg text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
        />
        </div>
      </div>
      {disabled && disabledReason && (
        <p className="text-xs text-ink-muted">{disabledReason}</p>
      )}
      {/* No standing keyboard hint under the card - the design puts nothing
          there, and a line of grey type that never changes stops being read
          after the first visit. It lives on the box's own tooltip instead,
          which is where someone who wonders goes looking. The box still
          speaks up when it has something to say: a suggestion to take, or a
          word it has just corrected. */}
      {ghostVisible ? (
        <p className="flex items-center gap-2 text-xs text-ink-muted" aria-live="polite">
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
        <p className="flex items-center gap-2 text-xs text-ink-muted">
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
      ) : null}
    </div>
  );
}
