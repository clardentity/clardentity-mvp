"use client";

import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";
import { cx } from "@/components/ui/primitives";

/* A vertical slot that cycles a few words in place.
 *
 * Three things make this harder than it looks:
 *
 * Width. The words are different lengths, so a naively sized box changes width
 * on every rotation and shoves whatever sits beside it sideways. An invisible
 * copy of the longest word holds the box open; the moving strip is absolutely
 * positioned over it and never affects layout.
 *
 * Vertical metrics. The window, and every word inside it, must be exactly one
 * line tall or the strip stops at boundaries and you see two half-words at
 * once. The line height is set explicitly in `em` - not left to inherit -
 * so it resolves against this component's own font size whatever the caller
 * passes in.
 *
 * Alignment. An overflow:hidden box has no usable baseline; a parent using
 * `items-baseline` will synthesise one from its bottom edge and the words will
 * float above the text beside them. Hence align-middle here and `items-center`
 * on the caller's side.
 *
 * Screen readers. An animated strip of three words reads as three words. The
 * strip is aria-hidden and one static, visually-hidden copy of the list is
 * exposed instead, so it is announced once, as a list, in order.
 */

const ROTATE_MS = 2200;
// Tall enough for descenders ("y" in identity/entity) without the window
// showing a sliver of the neighbouring word.
const LINE = "1.35em";

export function WordRotator({
  words,
  className,
  interval = ROTATE_MS,
}: {
  words: string[];
  className?: string;
  interval?: number;
}) {
  const [index, setIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % words.length), interval);
    return () => clearInterval(timer);
  }, [reducedMotion, words.length, interval]);

  // Reduced motion gets the whole list at once. Rotating without the motion
  // that explains it would just be text changing on its own, which is worse
  // than not animating. This is also what the server renders, so the markup
  // is meaningful before any JavaScript arrives.
  if (reducedMotion) {
    return <span className={className}>{words.join(", ")}</span>;
  }

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");

  return (
    <span
      className={cx("relative inline-block overflow-hidden align-middle", className)}
      style={{ height: LINE }}
    >
      {/* Holds the box at the width of the longest word so nothing reflows. */}
      <span className="invisible block whitespace-nowrap" style={{ lineHeight: LINE }} aria-hidden="true">
        {longest}
      </span>

      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{ transform: `translateY(-${(index * 100) / words.length}%)` }}
      >
        {words.map((word) => (
          <span key={word} className="block whitespace-nowrap" style={{ lineHeight: LINE }}>
            {word}
          </span>
        ))}
      </span>

      <span className="sr-only">{words.join(", ")}</span>
    </span>
  );
}
