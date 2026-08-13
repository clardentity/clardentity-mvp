"use client";

import { MODE_BY_VALUE, type CognitiveMode } from "@/lib/modes";
import type { Guidance } from "@/lib/sse";

/* Two suggestions about the question, offered as ghosts.
 *
 * Neither is a correction and neither blocks anything - the answer above is
 * already there and still stands. So this is drawn as faint as it can be and
 * still be read: no card, no fill, no accent until you hover the thing you can
 * act on. It brightens on hover of the whole row, which is the compromise
 * between "findable" and "not another box demanding attention".
 *
 * Both halves are null on most turns. A nudge that fires every time is chrome.
 */

export function GuidanceCard({
  guidance,
  onUseMode,
  onAskRefined,
  disabled,
}: {
  guidance: Guidance;
  onUseMode?: (mode: CognitiveMode) => void;
  onAskRefined?: (question: string) => void;
  disabled?: boolean;
}) {
  const mode = guidance.suggested_mode as CognitiveMode | null;
  const modeLabel = mode ? MODE_BY_VALUE[mode]?.label : null;
  const refined = guidance.refined_question;

  if (!modeLabel && !refined) return null;

  return (
    <div className="group/guide mt-2.5 space-y-1.5 opacity-55 transition-opacity hover:opacity-100">
      {modeLabel && mode && (
        <p className="text-[11px] leading-relaxed text-ink-muted">
          <span className="text-ink-secondary">Better suited to </span>
          <button
            type="button"
            onClick={() => onUseMode?.(mode)}
            disabled={disabled || !onUseMode}
            className="font-medium text-brand underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid disabled:no-underline disabled:opacity-60"
          >
            {modeLabel} mode
          </button>
          {guidance.mode_reason && <span> - {guidance.mode_reason}</span>}
        </p>
      )}

      {refined && (
        <p className="text-[11px] leading-relaxed text-ink-muted">
          <span className="text-ink-secondary">Did you mean: </span>
          <button
            type="button"
            onClick={() => onAskRefined?.(refined)}
            disabled={disabled || !onAskRefined}
            className="text-left italic text-brand underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid disabled:no-underline disabled:opacity-60"
          >
            {refined}
          </button>
          {guidance.refinement_reason && <span> - {guidance.refinement_reason}</span>}
        </p>
      )}
    </div>
  );
}
