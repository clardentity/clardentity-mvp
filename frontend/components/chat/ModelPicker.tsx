"use client";

import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui/primitives";
import { UpgradeDialog } from "@/components/chat/UpgradeDialog";

/* Model selection, named by capability rather than by vendor.
 *
 * The rows used to read ChatGPT / Claude / Gemini, which was three leaks at
 * once: it announced the whole vendor set on the composer, contradicting the
 * identity rules the backend enforces on every generation; it let anyone infer
 * from which models were gated roughly what the cheap path costs; and since
 * vendor API prices are published, per-vendor pricing is a public cost sheet
 * anyone can compute a markup from.
 *
 * Clar is Clardentity's own model family, so the tiers describe what you get -
 * depth, breadth, reasoning - and routing stays an implementation detail we
 * can change without it being a pricing conversation.
 */

type Model = {
  id: string;
  label: string;
  blurb: string;
  detail: string;
  locked: boolean;
};

const MODELS: Model[] = [
  {
    id: "auto",
    label: "Auto",
    blurb: "Clardentity picks for each question.",
    detail:
      "Routes every question to whichever Clar tier suits it, so simple questions stay fast and hard ones get the depth they need. The default, and the right choice for most work.",
    locked: false,
  },
  {
    id: "clar-pro",
    label: "Clar Pro",
    blurb: "For advanced, specialist work.",
    detail:
      "Holds longer chains of reasoning than Auto and stays precise on technical and domain-specific questions. For work where the answer has to be right in the details, not just broadly correct.",
    locked: true,
  },
  {
    id: "clar-max",
    label: "Clar Max",
    blurb: "Wider context, deeper checking.",
    detail:
      "Reads further into your attachments, searches more widely, and pushes each claim through more verification before it reaches you. For research, long documents, and questions with a lot of ground to cover.",
    locked: true,
  },
  {
    id: "clar-ultra",
    label: "Clar Ultra",
    blurb: "Our most intelligent reasoner.",
    detail:
      "The most capable Clar tier, for problems where getting it right matters more than getting it quickly: ambiguous tradeoffs, novel analysis, and decisions you only make once.",
    locked: true,
  },
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
  // Which row the pointer or keyboard focus is on, so the detail card can
  // describe it. Null closes the card.
  const [hovered, setHovered] = useState<string | null>(null);
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
  const described = MODELS.find((m) => m.id === hovered) ?? null;

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
            onMouseLeave={() => setHovered(null)}
            // No overflow-hidden: the detail card is positioned outside this
            // box, and clipping the corners it doesn't need cost the whole
            // card. Rows carry their own rounding.
            className="absolute bottom-full left-0 z-40 mb-2 w-64 rounded-xl border border-hairline bg-surface p-1 shadow-xl"
          >
            {MODELS.map((model) => (
              <button
                key={model.id}
                type="button"
                role="menuitem"
                onMouseEnter={() => setHovered(model.id)}
                onFocus={() => setHovered(model.id)}
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
                  model.locked && "opacity-60",
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

            {/* Sits beside the menu rather than over it, so the row you are
                pointing at stays visible while you read about it. Hidden on
                narrow screens, where there is nowhere for it to go and the
                one-line blurb is already in the row. */}
            {described && (
              <div
                role="tooltip"
                className="absolute bottom-0 left-full ml-2 hidden w-60 rounded-xl border border-hairline bg-surface p-3 shadow-xl lg:block"
              >
                <p className="text-xs font-semibold text-ink">{described.label}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">
                  {described.detail}
                </p>
                {described.locked && (
                  <p className="mt-2 text-[11px] font-medium text-brand">Included with Pro</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <UpgradeDialog open={upsell !== null} trigger={upsell} onClose={() => setUpsell(null)} />
    </>
  );
}
