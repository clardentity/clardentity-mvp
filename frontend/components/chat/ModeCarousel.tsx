"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage } from "@/lib/sse";
import { MODE_BY_VALUE, type CognitiveMode } from "@/lib/modes";
import { cx } from "@/components/ui/primitives";

/* A conversation that switched modes is really several conversations
 * interleaved: the Decision turns and the Learning turns are about the same
 * subject but are not answering each other, and reading them as one column
 * makes the reasoning look like it contradicts itself.
 *
 * So each mode gets its own track. One is in focus; the others sit either side
 * at reduced width and opacity - present, legible enough to see there is more,
 * and one gesture away.
 *
 * The trade-off worth naming: this hides messages. A linear transcript is the
 * only view where "what was said, in order" is answerable at a glance, so the
 * carousel is opt-out (the toggle in the header) and never appears at all
 * until a second mode actually shows up.
 */

type Track = { mode: CognitiveMode; messages: ChatMessage[] };

// Movement before a press counts as a drag rather than a selection or a click.
const DRAG_START_PX = 8;
// Movement before releasing actually changes track.
const DRAG_COMMIT_PX = 70;

export function groupByMode(messages: ChatMessage[]): Track[] {
  const order: CognitiveMode[] = [];
  const byMode = new Map<CognitiveMode, ChatMessage[]>();

  for (const message of messages) {
    const mode = message.mode_used as CognitiveMode;
    if (!MODE_BY_VALUE[mode]) continue;
    if (!byMode.has(mode)) {
      byMode.set(mode, []);
      // First appearance decides the order, so tracks don't reshuffle
      // underneath the reader as the conversation grows.
      order.push(mode);
    }
    byMode.get(mode)!.push(message);
  }

  return order.map((mode) => ({ mode, messages: byMode.get(mode)! }));
}

function StepButton({
  direction,
  disabled,
  onClick,
}: {
  direction: "previous" | "next";
  disabled: boolean;
  onClick: () => void;
}) {
  const label = direction === "previous" ? "Previous mode" : "Next mode";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cx(
        "rounded-full p-1.5 text-ink-muted transition-colors",
        "hover:bg-surface-hover hover:text-ink",
        // Kept in the layout when unavailable rather than removed, so the
        // pills don't shift sideways as you reach the ends.
        "disabled:pointer-events-none disabled:opacity-25",
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-3.5 w-3.5"
      >
        {direction === "previous" ? (
          <path d="M15 18l-6-6 6-6" />
        ) : (
          <path d="M9 18l6-6-6-6" />
        )}
      </svg>
    </button>
  );
}

export function ModeCarousel({
  tracks,
  activeIndex,
  onActiveIndexChange,
  renderMessages,
}: {
  tracks: Track[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  // The mode comes with the messages so the caller can decide which track a
  // streaming answer belongs in - it arrives while you may be reading a
  // different one.
  renderMessages: (messages: ChatMessage[], mode: CognitiveMode) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState(0);
  // Whether a drag is in progress is *rendered* (it suppresses the transition
  // and the text selection), so it has to be state.
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);
  // The offset is mirrored into a ref because pointerup has to *decide* on it.
  // Reading the state there means reading whatever the last render captured,
  // and a fast flick can deliver move and up inside one frame - in which case
  // the handler sees 0 and the swipe silently does nothing.
  const dragOffsetRef = useRef(0);

  const clamp = (index: number) => Math.max(0, Math.min(tracks.length - 1, index));

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Only when the carousel itself has focus - the composer is a textarea
      // and arrow keys belong to it.
      if (!containerRef.current?.contains(document.activeElement)) return;
      if (event.key === "ArrowLeft") onActiveIndexChange(clamp(activeIndex - 1));
      if (event.key === "ArrowRight") onActiveIndexChange(clamp(activeIndex + 1));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  /* Horizontal wheel movement is what a trackpad two/three-finger swipe
     produces, so it drives the carousel; vertical stays with the message list
     it is scrolling. The threshold stops a slightly-off vertical scroll from
     throwing the reader into another mode. */
  function onWheel(event: React.WheelEvent) {
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.5) return;
    if (Math.abs(event.deltaX) < 30) return;
    onActiveIndexChange(clamp(activeIndex + (event.deltaX > 0 ? 1 : -1)));
  }

  function onPointerDown(event: React.PointerEvent) {
    // A mouse drag is how you select text, and that is almost always what it
    // means inside a wall of prose. Trying to serve both from one gesture is
    // what made responses impossible to copy: any horizontal sweep past 8px
    // tore the selection down and swiped the track instead. Mice get the
    // arrows, the pills, the keyboard and horizontal wheel/trackpad swipe
    // (onWheel, which is what the MacBook two-finger gesture actually emits);
    // dragging the track with a finger stays a touch and pen affordance.
    if (event.pointerType === "mouse") return;
    // Ignore drags that start on something interactive - selecting text in a
    // message shouldn't swipe the track out from under the selection.
    if ((event.target as HTMLElement).closest("button, a, textarea, input")) return;
    dragStart.current = event.clientX;
    dragOffsetRef.current = 0;
    // Not `dragging` yet. A press that never moves is a click, and a press
    // that moves a few pixels is usually the start of a text selection - only
    // past the threshold below does this become a drag.
    setDragOffset(0);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (dragStart.current === null) return;
    const travelled = event.clientX - dragStart.current;

    if (!dragging) {
      if (Math.abs(travelled) < DRAG_START_PX) return;
      setDragging(true);
      // Whatever the browser started selecting on the way here is collateral
      // from a gesture the user meant as a swipe. Dropping it is the whole
      // fix for "dragging highlights text".
      window.getSelection()?.removeAllRanges();
    }

    // Suppresses the browser's own drag-select for the rest of the gesture.
    event.preventDefault();
    dragOffsetRef.current = travelled;
    setDragOffset(travelled);
  }

  function onPointerUp() {
    if (dragStart.current === null) return;
    const travelled = dragOffsetRef.current;
    dragStart.current = null;
    dragOffsetRef.current = 0;
    setDragging(false);
    setDragOffset(0);
    if (Math.abs(travelled) > DRAG_COMMIT_PX) {
      onActiveIndexChange(clamp(activeIndex + (travelled < 0 ? 1 : -1)));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={containerRef}>
      {/* Arrows either side of the pills. The swipe is the nice way to do
          this and the pills are the direct way, but neither helps someone on a
          mouse who wants the next track without aiming at a specific one. */}
      {/* Arrows either side of the current mode's name, and nothing else. A
          pill per mode meant the row grew with the conversation and put a
          filled accent-coloured chip above every answer; the name alone says
          where you are, and the arrows say there is more. */}
      <nav
        aria-label="Modes in this chat"
        className="flex shrink-0 items-center justify-center gap-2 py-1.5"
      >
        <StepButton
          direction="previous"
          disabled={activeIndex === 0}
          onClick={() => onActiveIndexChange(clamp(activeIndex - 1))}
        />
        <span
          aria-live="polite"
          className="min-w-24 text-center text-xs font-medium text-ink-secondary"
        >
          {MODE_BY_VALUE[tracks[activeIndex]?.mode]?.label}
          <span className="ml-1.5 tabular-nums text-ink-muted">
            {activeIndex + 1}/{tracks.length}
          </span>
        </span>
        <StepButton
          direction="next"
          disabled={activeIndex === tracks.length - 1}
          onClick={() => onActiveIndexChange(clamp(activeIndex + 1))}
        />
      </nav>

      <div
        className={cx(
          // The neighbouring tracks are meant to say "there is more this
          // way", not to be read - the edge fade turns them into a hint
          // rather than a watermark. It lives in CSS because it only applies
          // at widths where neighbours are actually visible.
          "carousel-viewport relative min-h-0 flex-1 overflow-hidden",
          // Only while a drag is live: killing selection permanently would
          // make it impossible to copy anything out of a message.
          dragging && "select-none",
        )}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={cx(
            "carousel-track flex h-full",
            // No transition mid-drag: the track should follow the finger, and
            // an eased transform lagging behind a pointer feels broken.
            !dragging && "transition-transform duration-300 ease-out",
          )}
          style={{
            // Step and peek come from CSS custom properties so they can
            // change at the breakpoint with the track width - a full-width
            // track has to advance by a full width, and a peek offset for
            // neighbours that aren't rendered would push it off centre.
            transform: `translateX(calc(${-activeIndex} * var(--track-step) + var(--track-peek) + ${dragOffset}px))`,
          }}
        >
          {tracks.map((track, index) => {
            const isActive = index === activeIndex;
            return (
              <section
                key={track.mode}
                aria-hidden={!isActive}
                className={cx(
                  // Full width below sm: at 375px a 78% track leaves ~290px
                  // of readable column with blurred content either side, and
                  // the peek costs more than the "there is more this way" it
                  // buys. The arrows above already say that.
                  "flex h-full w-full shrink-0 flex-col px-1 transition-all duration-300 sm:w-[78%] sm:px-2",
                  isActive ? "opacity-100" : "pointer-events-none opacity-20",
                )}
                style={
                  // Blurred, not just dimmed. Faint-but-sharp text still reads
                  // as text and the eye keeps trying to parse it; out of focus
                  // it registers as "another column" and stops competing.
                  isActive ? undefined : { filter: "blur(2px)" }
                }
              >
                {/* No card around the track. The border, its rounding and the
                    repeated mode heading cost ~40px of vertical space on a
                    column whose height is the scarce thing, and framed a
                    conversation that is already the only thing on screen. The
                    nav above says which mode this is. */}
                <div className="flex min-h-0 flex-1 flex-col">
                  {renderMessages(track.messages, track.mode)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
