"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { autocorrectSupported, fixAtBoundary, loadSpeller, type Fix, type Speller } from "@/lib/autocorrect";
import { apiFetch } from "@/lib/apiClient";
import { AudioRecorder } from "@/components/upload/AudioRecorder";
import { ModelPicker } from "@/components/chat/ModelPicker";
import { cx } from "@/components/ui/primitives";

export type PendingImage = { data: string; mimeType: string; previewUrl: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
  onSend: (content: string, images: PendingImage[]) => void;
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
  const [images, setImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
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
  /* The wand: grammar and phrasing, on request, by the smallest model
     (POST /compose/polish). Spelling is handled as you type without one;
     grammar can't be, and nobody wants a model reading every keystroke, so
     this is one press. The result replaces the draft and can be undone -
     "Polished · Undo" in the same chip as autocorrect uses. */
  const [polishing, setPolishing] = useState(false);
  const [polished, setPolished] = useState<{ from: string; to: string } | null>(null);
  const [polishNote, setPolishNote] = useState<string | null>(null);

  async function handlePolish() {
    const draft = value.trim();
    if (!draft || polishing || disabled) return;
    setPolishing(true);
    setPolishNote(null);
    try {
      const res = await apiFetch<{ text: string; changed: boolean }>("/compose/polish", {
        method: "POST",
        body: { text: draft },
      });
      if (!res.changed) {
        setPolishNote("Reads fine as it is.");
        return;
      }
      setPolished({ from: value, to: res.text });
      setLastFix(null);
      pendingCaretRef.current = res.text.length;
      onChange(res.text);
    } catch {
      setPolishNote("Couldn't tidy that just now - your message is unchanged.");
    } finally {
      setPolishing(false);
    }
  }

  function undoPolish() {
    if (!polished || value !== polished.to) {
      setPolished(null);
      return;
    }
    pendingCaretRef.current = polished.from.length;
    setPolished(null);
    onChange(polished.from);
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
    if (polished && newValue !== polished.to) setPolished(null);
    if (polishNote) setPolishNote(null);
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
    onSend(trimmed, images);
    onChange("");
    setImages([]);
    onTypingChange?.(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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

  async function handleImageSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;

    setImageError(null);
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("Image must be under 5MB");
      return;
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const base64 = dataUrl.split(",")[1] ?? "";
    setImages((prev) => [
      ...prev,
      { data: base64, mimeType: file.type || "image/jpeg", previewUrl: dataUrl },
    ]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-1">
      {images.length > 0 && (
        <div className="flex gap-2">
          {images.map((img, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt="Attached"
                className="h-14 w-14 rounded-md border border-hairline-strong object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-ink text-[9px] text-surface transition-opacity hover:opacity-80"
                aria-label="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {imageError && <p className="text-xs text-band-low">{imageError}</p>}

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
          title="Attach an image"
          aria-label="Attach an image"
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
            accept="image/*"
            onChange={handleImageSelected}
            className="hidden"
          />

          <button
            type="button"
            data-tour="polish"
            onClick={() => void handlePolish()}
            disabled={disabled || polishing || value.trim().split(/\s+/).length < 3}
            title="Tidy grammar and phrasing"
            aria-label="Tidy grammar and phrasing"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {polishing ? (
              <span className="block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
            ) : (
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
                {/* A wand with a spark: tidy this. */}
                <path d="M15 4V2M15 10V8M11 6H9M21 6h-2M17.5 3.5l-1 1M17.5 8.5l-1-1M12.5 3.5l1 1M12.5 8.5l1-1" />
                <path d="M3 21 14 10" />
              </svg>
            )}
          </button>

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

        <textarea
          ref={taRef}
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
          className="order-1 w-full flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
        />
      </div>
      {disabled && disabledReason && (
        <p className="text-xs text-ink-muted">{disabledReason}</p>
      )}
      {/* The keyboard hint left the placeholder, where it cost two of the
          three visible lines on a phone to explain a chord that phone has no
          way to type. Kept for pointer devices, where it is discoverable and
          free. */}
      {polished && value === polished.to ? (
        <p className="flex items-center gap-2 text-[11px] text-ink-muted">
          <span>Tidied grammar and phrasing.</span>
          <button type="button" onClick={undoPolish} className="font-medium text-brand hover:underline">
            Undo
          </button>
        </p>
      ) : polishNote ? (
        <p className="text-[11px] text-ink-muted">{polishNote}</p>
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
