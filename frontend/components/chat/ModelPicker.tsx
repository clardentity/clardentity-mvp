"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";
import { UpgradeDialog } from "@/components/chat/UpgradeDialog";

/* Model selection, of which exactly one option currently does anything.
 *
 * "Auto" is the product: Clardentity routes the question itself, and which
 * model it lands on is deliberately never stated - see the identity rules in
 * the backend prompt. The three named entries are roadmap, shown locked, and
 * are the entry point to the Pro upsell.
 *
 * They describe what Pro will offer rather than what is running now, which is
 * why naming them here does not contradict the identity rules: a locked
 * "Claude" row is a thing you could buy, not a statement about what answered
 * your last question.
 */

type Model = { id: string; label: string; blurb: string; locked: boolean };

const MODELS: Model[] = [
  {
    id: "auto",
    label: "Auto",
    blurb: "Clardentity picks the right engine for the question.",
    locked: false,
  },
  { id: "chatgpt", label: "ChatGPT", blurb: "Route everything to GPT.", locked: true },
  { id: "claude", label: "Claude", blurb: "Route everything to Claude.", locked: true },
  { id: "gemini", label: "Gemini", blurb: "Route everything to Gemini.", locked: true },
];

function ChipIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 3v2M15 3v2M9 19v2M15 19v2M3 9h2M3 15h2M19 9h2M19 15h2" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-3 w-3 shrink-0"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function ModelPicker({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [upsell, setUpsell] = useState<string | null>(null);
  const [selected, setSelected] = useState("auto");
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = MODELS.find((m) => m.id === selected) ?? MODELS[0];

  return (
    <>
      <div ref={wrapRef} className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
          title={`Model: ${current.label}`}
          aria-label={`Model: ${current.label}. Change model.`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChipIcon className="h-4 w-4" />
        </button>

        {open && (
          <div
            role="menu"
            className="absolute bottom-full left-0 z-40 mb-2 w-64 overflow-hidden rounded-xl border border-hairline bg-surface p-1 shadow-xl"
          >
            {MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  if (model.locked) {
                    // The lock is the pitch. Opening the dialog from the click
                    // is the whole point of showing these rows at all.
                    setUpsell(model.label);
                    setOpen(false);
                    return;
                  }
                  setSelected(model.id);
                  setOpen(false);
                }}
                className={cx(
                  "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors",
                  "hover:bg-surface-hover",
                  model.locked && "opacity-45",
                )}
              >
                <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                  {model.locked ? (
                    <LockIcon />
                  ) : selected === model.id ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="h-3.5 w-3.5 text-brand"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-medium text-ink">{model.label}</span>
                    {model.locked && (
                      <span className="rounded-full bg-brand-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand">
                        Pro
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                    {model.blurb}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <UpgradeDialog open={upsell !== null} trigger={upsell} onClose={() => setUpsell(null)} />
    </>
  );
}
