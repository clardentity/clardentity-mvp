"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTour } from "@/lib/tour";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";
import { cx } from "@/components/ui/primitives";

type Rect = { top: number; left: number; width: number; height: number };
type Pos = { top: number; left: number };

/** AppShell renders its sidebar nav into two DOM locations at once - a
 *  desktop copy (`hidden lg:flex`, always mounted, CSS-hidden below the `lg`
 *  breakpoint) and a mobile-drawer copy (only mounted while the drawer is
 *  open). `document.querySelector` would always return the first in DOM
 *  order - the desktop one - which is a zero-size rect on a phone. Picking
 *  the first genuinely visible match handles that, and any future
 *  duplicated target, generically. */
function resolveVisibleTarget(target: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(`[data-tour="${target}"]`);
  for (const el of matches) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

const GRACE_MS = 500;
const MARGIN = 12;

export function TourOverlay() {
  const { active, step, stepIndex, total, isLast, advance, skip } = useTour();
  const reducedMotion = usePrefersReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const [ringRect, setRingRect] = useState<Rect | null>(null);
  const [calloutPos, setCalloutPos] = useState<Pos | null>(null);
  const focusedStepRef = useRef<number | null>(null);
  const scrolledStepRef = useRef<number | null>(null);

  const titleId = "tour-step-title";
  const bodyId = "tour-step-body";

  /* Re-resolves every frame rather than once, for two reasons specific to
   * this app, not general paranoia:
   *   - ModeSelector renders two structurally different trees depending on
   *     whether a mode is picked - a one-shot measurement would hold a
   *     stale reference the instant the user does the exact thing this step
   *     asks them to do.
   *   - Right after a route change, the next step's target may not have
   *     mounted yet for a frame or two. Polling absorbs this without a
   *     separate retry mechanism.
   * The same loop doubles as resize/scroll handling for free. */
  useEffect(() => {
    // Nothing to reset when inactive: the component renders null below
    // whenever `!active`, so stale rect/pos values just sit unused until
    // the next step's tick() loop overwrites them fresh.
    if (!active || !step) return;

    let raf = 0;
    let cancelled = false;
    const startedAt = performance.now();

    function tick() {
      if (cancelled) return;
      const panel = panelRef.current;
      const target = resolveVisibleTarget(step!.target);

      if (panel) {
        const panelRect = panel.getBoundingClientRect();

        if (target) {
          // Some steps' targets sit well below the fold - the composer, in
          // particular, once a tall mode-picker grid is also on screen.
          // Once, the first time this step finds its target (not every
          // tick - scrollIntoView fights a user who's already scrolling
          // manually otherwise): bring it into view if it isn't already.
          if (scrolledStepRef.current !== stepIndex) {
            scrolledStepRef.current = stepIndex;
            const initialRect = target.getBoundingClientRect();
            const fullyVisible = initialRect.top >= 0 && initialRect.bottom <= window.innerHeight;
            if (!fullyVisible) {
              target.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
            }
          }

          const rect = target.getBoundingClientRect();
          setRingRect((prev) =>
            prev &&
            prev.top === rect.top &&
            prev.left === rect.left &&
            prev.width === rect.width &&
            prev.height === rect.height
              ? prev
              : { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
          );

          let left = rect.left;
          left = Math.min(left, window.innerWidth - panelRect.width - MARGIN);
          left = Math.max(left, MARGIN);

          let top = rect.bottom + MARGIN;
          if (top + panelRect.height + MARGIN > window.innerHeight) {
            top = rect.top - panelRect.height - MARGIN;
          }
          top = Math.min(top, window.innerHeight - panelRect.height - MARGIN);
          top = Math.max(top, MARGIN);

          setCalloutPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
        } else if (performance.now() - startedAt > GRACE_MS) {
          // Anchorless fallback: the target isn't reachable right now (the
          // user wandered elsewhere, or - on a phone - the sidebar step
          // while the drawer is closed). Stay dismissable and legible
          // rather than disappearing or waiting indefinitely.
          setRingRect(null);
          const top = (window.innerHeight - panelRect.height) / 2;
          const left = (window.innerWidth - panelRect.width) / 2;
          setCalloutPos((prev) => (prev && prev.top === top && prev.left === left ? prev : { top, left }));
        }
        // Within the grace period and not yet found: leave state as-is
        // (null on first activation) so nothing flashes at a wrong
        // position for one frame.
      }

      raf = requestAnimationFrame(tick);
    }

    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [active, step, stepIndex, reducedMotion]);

  // Focus the panel once per step, at the first moment it has a real
  // position - not on every measurement tick. This is what makes a step
  // change perceivable to a keyboard/screen-reader user across the one
  // cross-page transition, where Next.js's own navigation would otherwise
  // silently drop focus back to <body> with no announcement at all.
  useLayoutEffect(() => {
    if (!active || !calloutPos) return;
    if (focusedStepRef.current === stepIndex) return;
    focusedStepRef.current = stepIndex;
    panelRef.current?.focus();
  }, [active, calloutPos, stepIndex]);

  // Escape ends the tour - scoped to exactly while it's active, matching
  // every other overlay in this codebase (UpgradeDialog, ChatView's
  // generation-stop): the currently-relevant overlay owns Escape, nothing
  // is bound globally by default.
  useEffect(() => {
    if (!active) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") skip();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, skip]);

  if (!active || !step) return null;

  const visible = calloutPos !== null;

  return createPortal(
    <>
      {ringRect && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            top: ringRect.top - 4,
            left: ringRect.left - 4,
            width: ringRect.width + 8,
            height: ringRect.height + 8,
            borderRadius: 10,
            // The huge spread on the second shadow is the standard
            // "spotlight cutout" trick: it paints a dimmed layer over the
            // entire viewport outside this box, while the box's own
            // interior stays clear. Crucially, a box-shadow never
            // participates in hit-testing regardless of spread, so - unlike
            // a real dimmed backdrop element - it blocks nothing. The rest
            // of the page stays fully clickable throughout, which is what
            // makes "cancel at any time" (and just clicking the real "New
            // chat" button through the tour) trivially true rather than
            // something extra to build.
            boxShadow: "0 0 0 2px var(--brand), 0 0 0 9999px rgba(0,0,0,0.6)",
            pointerEvents: "none",
            // No CSS transition here, deliberately: the RAF loop re-measures
            // every frame while a step is active (that's what keeps this
            // correct across ModeSelector's node swap and right after a
            // route change), and a page can genuinely settle into its final
            // layout across several different measurements in quick
            // succession right after mounting. A transition would restart
            // on each of those, so the ring visibly lagged behind and
            // briefly sat at the wrong spot rather than snapping straight to
            // wherever the target actually is - confirmed by comparing the
            // inline style (the latest target) against the rendered
            // getBoundingClientRect() (the still-animating value) while
            // this was in place. Snapping is correct here even though it
            // gives up a bit of polish.
          }}
        />
      )}
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={{
          position: "fixed",
          top: calloutPos ? calloutPos.top : -9999,
          left: calloutPos ? calloutPos.left : -9999,
          visibility: visible ? "visible" : "hidden",
        }}
        className={cx(
          "z-[45] w-72 max-w-[calc(100vw-1.5rem)] rounded-xl border border-hairline bg-surface-raised p-4 shadow-2xl focus:outline-none",
          visible && !reducedMotion && "animate-[fade-in_0.35s_ease]",
        )}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
          Step {stepIndex + 1} of {total}
        </p>
        <h2 id={titleId} className="mt-1 text-sm font-semibold text-ink">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1 text-sm leading-relaxed text-ink-secondary">
          {step.body}
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={skip}
            className="rounded-full px-2.5 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Skip tour
          </button>
          {step.showNext && (
            <button
              type="button"
              onClick={advance}
              className="rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-dark"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
