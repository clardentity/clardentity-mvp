"use client";

import { useState } from "react";

/** Inline tag after a sentence the model marked as its own view rather than a
 *  sourced fact. Opinions carry no citation, so without this they had no
 *  visible marker at all once the evidence panel went - a reader couldn't tell
 *  a sourced sentence from an unsourced one. Tap to read what the tag means;
 *  a title alone would be invisible on a phone. Rendered as spans because it
 *  sits inside the answer's own <p>. */
export function OpinionMarker() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Stated as an opinion - Clardentity's own view, not a sourced fact"
        className="mx-0.5 rounded border border-hairline-strong bg-surface-muted px-1 align-super text-[9px] font-semibold uppercase tracking-wide text-ink-secondary transition-colors hover:border-brand-border hover:text-ink"
      >
        opinion
      </button>
      {open && (
        <span className="mx-1 inline-block rounded-md border border-hairline bg-surface-raised px-2 py-1 align-middle text-[11px] font-normal normal-case leading-snug text-ink-secondary shadow-lg">
          Stated as an opinion: Clardentity&apos;s own view on this, not something
          a source backs. Weigh it as you would a person&apos;s take.
        </span>
      )}
    </>
  );
}
