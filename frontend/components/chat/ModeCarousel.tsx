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

export function ModeCarousel({
  tracks,
  activeIndex,
  onActiveIndexChange,
  renderMessages,
}: {
  tracks: Track[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  renderMessages: (messages: ChatMessage[]) => ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dragOffset, setDragOffset] = useState(0);
  // Whether a drag is in progress is *rendered* (it suppresses the transition),
  // so it has to be state. The starting x is not, so it stays a ref.
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<number | null>(null);

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
    // Ignore drags that start on something interactive - selecting text in a
    // message shouldn't swipe the track out from under the selection.
    if ((event.target as HTMLElement).closest("button, a, textarea, input")) return;
    dragStart.current = event.clientX;
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (dragStart.current === null) return;
    setDragOffset(event.clientX - dragStart.current);
  }

  function onPointerUp() {
    if (dragStart.current === null) return;
    const travelled = dragOffset;
    dragStart.current = null;
    setDragging(false);
    setDragOffset(0);
    if (Math.abs(travelled) > 70) {
      onActiveIndexChange(clamp(activeIndex + (travelled < 0 ? 1 : -1)));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" ref={containerRef}>
      <nav
        aria-label="Modes in this conversation"
        className="flex shrink-0 items-center justify-center gap-1 py-2"
      >
        {tracks.map((track, index) => (
          <button
            key={track.mode}
            type="button"
            onClick={() => onActiveIndexChange(index)}
            aria-current={index === activeIndex ? "true" : undefined}
            className={cx(
              "rounded-full px-3 py-1 text-xs font-medium transition-colors",
              index === activeIndex
                ? "bg-brand text-white"
                : "text-ink-muted hover:bg-surface-hover hover:text-ink",
            )}
          >
            {MODE_BY_VALUE[track.mode].label}
            <span className="ml-1.5 opacity-70">{track.messages.length}</span>
          </button>
        ))}
      </nav>

      <div
        className="relative min-h-0 flex-1 overflow-hidden"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div
          className={cx(
            "flex h-full",
            // No transition mid-drag: the track should follow the finger, and
            // an eased transform lagging behind a pointer feels broken.
            !dragging && "transition-transform duration-300 ease-out",
          )}
          style={{
            // Each track is 78% wide, so ~11% of each neighbour shows on
            // either side. Translating by 78% per step keeps the active one
            // centred: the 11% offset places its left edge correctly.
            transform: `translateX(calc(${-activeIndex * 78 + 11}% + ${dragOffset}px))`,
          }}
        >
          {tracks.map((track, index) => {
            const isActive = index === activeIndex;
            return (
              <section
                key={track.mode}
                aria-hidden={!isActive}
                className={cx(
                  "flex h-full w-[78%] shrink-0 flex-col px-2 transition-opacity duration-300",
                  isActive ? "opacity-100" : "pointer-events-none opacity-35",
                )}
              >
                <div
                  className={cx(
                    "flex min-h-0 flex-1 flex-col rounded-2xl border transition-colors",
                    isActive ? "border-brand-border" : "border-hairline",
                  )}
                >
                  <p className="shrink-0 border-b border-hairline px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    {MODE_BY_VALUE[track.mode].label}
                  </p>
                  {renderMessages(track.messages)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
