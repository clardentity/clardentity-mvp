"use client";

import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui/primitives";

/* Two layers of honesty, in order of preference.
 *
 * When the server has said what it's doing - reading documents, searching the
 * web, weighing evidence - that's what's shown, because a specific claim about
 * the work beats a decorative one.
 *
 * Only in the gap before the first phase arrives does it fall back to the
 * rotating verbs. Those are theatre, and worth it: a spinner with no words
 * makes seconds feel like a hang, where "Pondering…" makes the same seconds
 * feel like somebody is on it. They rotate so a long wait doesn't look frozen.
 */

const IDLE_VERBS = [
  "Cogitating",
  "Pondering",
  "Turning it over",
  "Mulling",
  "Ruminating",
  "Thinking it through",
  "Considering",
  "Deliberating",
];

const ROTATE_MS = 2400;

export function ThinkingIndicator({ label }: { label?: string | null }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (label) return;
    const timer = setInterval(() => setIndex((i) => i + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [label]);

  const text = label ?? IDLE_VERBS[index % IDLE_VERBS.length];

  return (
    <p
      className="flex items-center gap-2 text-sm text-ink-muted"
      // Announced once, not on every rotation - a screen reader repeating
      // eight synonyms for "thinking" is worse than saying nothing.
      role="status"
      aria-label="Working"
    >
      <Spinner className="h-3.5 w-3.5" />
      <span key={text} className="animate-[fade-in_0.4s_ease]">
        {text}
        <span className="animate-pulse">…</span>
      </span>
    </p>
  );
}
