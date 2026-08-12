"use client";

import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { AudioRecorder } from "@/components/upload/AudioRecorder";

export type PendingImage = { data: string; mimeType: string; previewUrl: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
}: {
  disabled: boolean;
  disabledReason?: string;
  value: string;
  onChange: (value: string) => void;
  onSend: (content: string, images: PendingImage[]) => void;
  onTypingChange?: (isTyping: boolean) => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [images, setImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleChange(newValue: string) {
    onChange(newValue);
    onTypingChange?.(newValue.trim().length > 0);
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
      <div className="flex items-end gap-2 rounded-xl border border-hairline-strong bg-surface p-2">
        <AudioRecorder
          disabled={disabled}
          onTranscribed={(text) => handleChange((value ? value + " " : "") + text)}
        />

        <button
          type="button"
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

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          disabled={disabled}
          placeholder={
            disabled
              ? disabledReason ?? "Select a mode to start typing"
              : "Ask a question…  (Enter to send, Shift+Enter for a new line)"
          }
          className="flex-1 resize-none bg-transparent px-1 py-2 text-sm leading-relaxed text-ink placeholder:text-ink-muted focus:outline-none disabled:cursor-not-allowed"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {disabled && disabledReason && (
        <p className="text-xs text-ink-muted">{disabledReason}</p>
      )}
    </div>
  );
}
