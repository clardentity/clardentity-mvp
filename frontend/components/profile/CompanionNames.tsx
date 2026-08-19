"use client";

import { useState } from "react";

import { COGNITIVE_MODES } from "@/lib/modes";
import { saveCompanionNames, useCompanionNames } from "@/lib/companionNames";
import { cx } from "@/components/ui/primitives";

/* Name your companion, per mode.
 *
 * One name each rather than one overall: the four modes behave differently
 * enough that people think of them separately, and naming them separately is
 * what makes "this suits Nick" mean something in the mode nudge.
 *
 * Blank is a real answer, not an incomplete form - an unnamed mode goes by its
 * own label, which is why there is no placeholder pretending to be a value.
 */

const MAX = 24;

export function CompanionNames() {
  const saved = useCompanionNames();
  // Only the fields actually typed into are held here; everything else reads
  // through to the store. Copying `saved` into state and syncing it with an
  // effect would mean a cascading render on load, and would race the user's
  // typing against the fetch that populates it.
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const valueFor = (mode: string) => edits[mode] ?? saved[mode] ?? "";
  const dirty = COGNITIVE_MODES.some(
    (m) => valueFor(m.value).trim() !== (saved[m.value] ?? ""),
  );

  async function save() {
    setState("saving");
    const next: Record<string, string> = {};
    for (const m of COGNITIVE_MODES) {
      const v = valueFor(m.value).trim();
      if (v) next[m.value] = v;
    }
    try {
      await saveCompanionNames(next);
      setEdits({});
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-3">
      {COGNITIVE_MODES.map((mode) => (
        <label key={mode.value} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="w-24 shrink-0 text-sm text-ink-secondary">{mode.label}</span>
          <input
            value={valueFor(mode.value)}
            onChange={(e) => {
              setState("idle");
              setEdits((d) => ({ ...d, [mode.value]: e.target.value.slice(0, MAX) }));
            }}
            maxLength={MAX}
            placeholder={`Unnamed - shows as "${mode.label}"`}
            className={cx(
              "min-w-0 flex-1 rounded-lg border border-hairline bg-surface px-3 py-1.5",
              "text-sm text-ink placeholder:text-ink-muted focus:border-brand-border focus:outline-none",
            )}
          />
        </label>
      ))}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || state === "saving"}
          className={cx(
            "rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white",
            "transition-colors hover:bg-brand-dark disabled:opacity-40",
          )}
        >
          {state === "saving" ? "Saving…" : "Save names"}
        </button>
        {state === "saved" && !dirty && (
          <span className="text-xs text-ink-muted">Saved.</span>
        )}
        {state === "error" && (
          <span className="text-xs text-band-low">Could not save. Try again.</span>
        )}
      </div>
    </div>
  );
}
