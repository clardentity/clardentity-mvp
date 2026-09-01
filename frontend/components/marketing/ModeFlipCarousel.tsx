"use client";

import { useState } from "react";
import { COGNITIVE_MODES } from "@/lib/modes";
import { cx } from "@/components/ui/primitives";

/* Seven modes, always moving, always tappable.
 *
 * A static grid of seven cards has an awkward remainder whichever way it's
 * divided - one cell left empty, or one card artificially stretched to fill
 * it (the previous version spanned Knowing across two columns for exactly
 * this reason). A horizontal marquee sidesteps the arithmetic: any number of
 * cards reads as one continuous strip, and doubling the list is what makes
 * the loop seamless (see the duplicated render below) instead of visibly
 * snapping back to the start.
 *
 * Each card flips independently on tap, including against its own duplicate
 * further down the strip - flipping one never affects the other. The whole
 * strip pauses on hover or focus, so reading a flipped card doesn't mean
 * racing it off screen.
 */

type Mode = (typeof COGNITIVE_MODES)[number];

function ModeCard({ mode }: { mode: Mode }) {
  const [flipped, setFlipped] = useState(false);
  // The squash plays first, the face swaps while the card is a sliver (so the
  // change itself is never visible), then it unsquashes on the other side -
  // see the CSS comment on .mode-flip-card for why this replaces a true 3D
  // flip.
  const [squashed, setSquashed] = useState(false);

  function toggle() {
    setSquashed(true);
    window.setTimeout(() => {
      setFlipped((f) => !f);
      setSquashed(false);
    }, 200);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={flipped}
      aria-label={
        flipped
          ? `${mode.companion}. ${mode.detail} Tap to flip back.`
          : `${mode.companion}. Tap to see what it does.`
      }
      className={cx(
        "mode-flip-card h-48 w-64 shrink-0 rounded-2xl border p-5 text-left",
        flipped
          ? "border-brand-border bg-brand-soft"
          : "border-hairline bg-surface hover:border-brand-border",
        squashed && "is-squashed",
        "sm:h-52 sm:w-72",
      )}
    >
      {!flipped ? (
        <div className="flex h-full flex-col justify-between">
          <div>
            <span className="text-xs font-medium text-brand">{mode.hint}</span>
            <h3 className="mt-1.5 text-lg font-semibold tracking-[-0.01em] text-ink">
              {mode.companion}
            </h3>
          </div>
          <p className="text-sm leading-relaxed text-ink-muted">{mode.when}</p>
        </div>
      ) : (
        <div className="flex h-full flex-col justify-between">
          <div>
            <span className="text-xs font-medium text-brand">{mode.label}</span>
            <p className="mt-1.5 text-sm leading-relaxed text-ink">{mode.detail}</p>
          </div>
          <span className="text-xs text-ink-muted">Tap to flip back</span>
        </div>
      )}
    </button>
  );
}

export function ModeFlipCarousel() {
  // Rendered twice back to back: the marquee loops by translating exactly
  // -50%, which lands on a frame identical to the start only because both
  // halves are the same list.
  const doubled = [...COGNITIVE_MODES, ...COGNITIVE_MODES];

  return (
    <div className="-mx-5 overflow-hidden px-5 sm:-mx-6 sm:px-6">
      <div className="mode-marquee-track flex w-max gap-4">
        {doubled.map((mode, i) => (
          <ModeCard key={`${mode.value}-${i}`} mode={mode} />
        ))}
      </div>
    </div>
  );
}
