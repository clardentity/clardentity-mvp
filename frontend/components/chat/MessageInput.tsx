"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { AudioRecorder } from "@/components/upload/AudioRecorder";

export type PendingImage = { data: string; mimeType: string; previewUrl: string };

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function MessageInput({
  disabled,
  disabledReason,
  onSend,
  onTypingChange,
}: {
  disabled: boolean;
  disabledReason?: string;
  onSend: (content: string, images: PendingImage[]) => void;
  onTypingChange?: (isTyping: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<PendingImage[]>([]);
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleChange(newValue: string) {
    setValue(newValue);
    onTypingChange?.(newValue.trim().length > 0);
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, images);
    setValue("");
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
                className="h-14 w-14 rounded-md border border-slate-300 object-cover dark:border-slate-700"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-slate-700 text-[9px] text-white hover:bg-slate-900"
                aria-label="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {imageError && <p className="text-xs text-red-600 dark:text-red-400">{imageError}</p>}

      <div className="flex items-end gap-2">
        <AudioRecorder
          disabled={disabled}
          onTranscribed={(text) => handleChange((value ? value + " " : "") + text)}
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          title="Attach an image"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-sm text-slate-500 hover:border-brand hover:text-brand disabled:opacity-50 dark:border-slate-700"
        >
          📎
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelected}
          className="hidden"
        />

        <textarea
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={2}
          placeholder={
            disabled
              ? disabledReason ?? "Select a mode to start typing"
              : "Type your message…"
          }
          className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand focus:outline-none disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-900"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={disabled || !value.trim()}
          className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          Send
        </button>
      </div>
      {disabled && disabledReason && (
        <p className="text-xs text-slate-400">{disabledReason}</p>
      )}
    </div>
  );
}
