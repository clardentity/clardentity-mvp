"use client";

import { useState, type KeyboardEvent } from "react";

export function MessageInput({
  disabled,
  disabledReason,
  onSend,
  onTypingChange,
}: {
  disabled: boolean;
  disabledReason?: string;
  onSend: (content: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
}) {
  const [value, setValue] = useState("");

  function handleChange(newValue: string) {
    setValue(newValue);
    onTypingChange?.(newValue.trim().length > 0);
  }

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
    onTypingChange?.(false);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
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
