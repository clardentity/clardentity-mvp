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
    if (rect.width <= 0 || rect.height <= 0) continue;
    // The collapsed desktop sidebar is translated fully off the left edge,
    // not hidden - it keeps its size. Horizontally off-screen means "not
    // here"; vertically off-screen is left alone, since the tick below
    // scrolls those into view.
    if (rect.right <= 0 || rect.left >= window.innerWidth) continue;
    return el;
  }
  return null;
}

const GRACE_MS = 500;
const MARGIN = 12;

export function TourOverlay() {
  const { tour, active, step, stepIndex, total, isLast, advance, skip } = useTour();
  const reducedMotion = usePrefersReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  // Per-step one-shots, keyed on the step so they fire once per step and
  // again for the next one: focus, scroll-into-view, and the drawer request.
  const stepKey = `${tour ?? ""}:${stepIndex}`;
  // Measurements are stamped with the step they belong to and read back
  // only for the current one, so a new step starts with no ring and a
  // hidden callout rather than inheriting the previous step's for however
  // long its own first measurement takes (a stale ring around the wrong
  // thing is worse than a blank frame). Deriving it this way, instead of
  // resetting in the effect, keeps setState out of effect bodies.
  const [ringState, setRingState] = useState<{ key: string; rect: Rect } | null>(null);
  const [calloutState, setCalloutState] = useState<{ key: string; pos: Pos } | null>(null);
  const ringRect = ringState && ringState.key === stepKey ? ringState.rect : null;
  const calloutPos = calloutState && calloutState.key === stepKey ? calloutState.pos : null;
  const focusedStepRef = useRef<string | null>(null);
  const scrolledStepRef = useRef<string | null>(null);
  const drawerAskedRef = useRef<string | null>(null);

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

    // A step whose target is on the page itself must not be read through
    // the phone's nav drawer, which an earlier sidebar step may have opened.
    // No-op wherever the drawer isn't open.
    if (!step.sidebar) window.dispatchEvent(new CustomEvent("clardentity:close-nav"));

    function placeCallout(top: number, left: number) {
      setCalloutState((prev) =>
        prev && prev.key === stepKey && prev.pos.top === top && prev.pos.left === left
          ? prev
          : { key: stepKey, pos: { top, left } },
      );
    }

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
          if (scrolledStepRef.current !== stepKey) {
            scrolledStepRef.current = stepKey;
            const initialRect = target.getBoundingClientRect();
            const fullyVisible = initialRect.top >= 0 && initialRect.bottom <= window.innerHeight;
            if (!fullyVisible) {
              target.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
            }
          }

          const rect = target.getBoundingClientRect();
          setRingState((prev) =>
            prev &&
            prev.key === stepKey &&
            prev.rect.top === rect.top &&
            prev.rect.left === rect.left &&
            prev.rect.width === rect.width &&
            prev.rect.height === rect.height
              ? prev
              : {
                  key: stepKey,
                  rect: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
                },
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

          placeCallout(top, left);
        } else if (step!.sidebar && drawerAskedRef.current !== stepKey) {
          // A sidebar target that can't be found is, on a phone, the
          // closed drawer. Ask the shell to open it (AppShell listens);
          // the next frames then find the real element. Once per step, so
          // a user who deliberately closes the drawer isn't fought.
          drawerAskedRef.current = stepKey;
          window.dispatchEvent(new CustomEvent("clardentity:open-nav"));
        } else if (performance.now() - startedAt > GRACE_MS) {
          // Anchorless fallback: the target isn't reachable right now (the
          // user wandered elsewhere). Stay dismissable and legible rather
          // than disappearing or waiting indefinitely.
          setRingState((prev) => (prev && prev.key === stepKey ? null : prev));
          const top = (window.innerHeight - panelRect.height) / 2;
          const left = (window.innerWidth - panelRect.width) / 2;
          placeCallout(top, left);
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
  }, [active, step, stepKey, reducedMotion]);

  // Focus the panel once per step, at the first moment it has a real
  // position - not on every measurement tick. This is what makes a step
  // change perceivable to a keyboard/screen-reader user across the one
  // cross-page transition, where Next.js's own navigation would otherwise
  // silently drop focus back to <body> with no announcement at all.
  useLayoutEffect(() => {
    if (!active || !calloutPos) return;
    if (focusedStepRef.current === stepKey) return;
    focusedStepRef.current = stepKey;
    panelRef.current?.focus();
  }, [active, calloutPos, stepKey]);

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
            // Above the shell's sidebar (z-20) and phone drawer (z-40),
            // below the callout (45): the ring must paint over the very
            // surfaces its targets live in.
            zIndex: 44,
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
          {tour === "chat" ? "Chat tour" : "Workspace tour"} · {stepIndex + 1} of {total}
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
          <button
            type="button"
            onClick={advance}
            className="inline-flex items-center gap-1.5 rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-dark"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="h-3.5 w-3.5"
            >
              <path d="M5 12.5l4.5 4.5L19 7" />
            </svg>
            {isLast ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}
