"use client";

import { useLayoutEffect, useRef } from "react";

/* The small mark in the empty middle of each landing card - phone layout
 * only. One symmetrical shape per card that says what the card says, drawn
 * as a fine outline in a slightly pink hairline (the card border's colour
 * with a touch of the accent: plum in light, pink in dark).
 *
 * Centred in the space the card's text leaves, measured rather than assumed:
 * a two-line blurb and a three-line one leave different gaps, and a fixed
 * position sat visibly high in one and low in the other. Nothing else on
 * the card moves - the mark sits behind the text. */

const EDGE = "color-mix(in srgb, var(--border-strong) 60%, var(--brand))";
// the card's own colour, where an outline must hide what passes behind it
const BEHIND = "var(--surface-muted)";
const LINE = 2.6; // in the 100-unit box: about 1.8px at the card's mark size

/** A four-point sparkle with long, thin arms. */
function spark(cx: number, cy: number, r: number): string {
  const a = r * 0.08, b = r * 0.14, w = r * 0.55;
  return `M${cx} ${cy - r} C${cx + a} ${cy - b} ${cx + b} ${cy - a} ${cx + w} ${cy} C${cx + b} ${cy + a} ${cx + a} ${cy + b} ${cx} ${cy + r} C${cx - a} ${cy + b} ${cx - b} ${cy + a} ${cx - w} ${cy} C${cx - b} ${cy - a} ${cx - a} ${cy - b} ${cx} ${cy - r}Z`;
}

const line = { fill: "none", stroke: EDGE } as const;
const round = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

function Spark({ cx, cy, r, w = LINE, behind = false }: { cx: number; cy: number; r: number; w?: number; behind?: boolean }) {
  return <path d={spark(cx, cy, r)} style={{ fill: behind ? BEHIND : "none", stroke: EDGE }} strokeWidth={w} strokeLinejoin="round" />;
}
function Ring({ cx, cy, r, w = LINE, opacity }: { cx: number; cy: number; r: number; w?: number; opacity?: number }) {
  return <circle cx={cx} cy={cy} r={r} style={line} strokeWidth={w} opacity={opacity} />;
}

const SHAPES: Record<string, React.ReactNode> = {
  // Ask: one question, sent out to the three models best suited for it -
  // round dots, each line starting well clear of the star (so the three
  // don't bunch where they meet) and stopping clear of each model.
  "Ask.": (
    <>
      <Spark cx={50} cy={80} r={16} />
      <path d="M42.5 54.6 L24.9 32.6 M50.0 52.0 L50.0 27.0 M57.5 54.6 L75.1 32.6" style={line} strokeWidth={2.8} strokeDasharray="0.1 7" strokeLinecap="round" />
      <Ring cx={18} cy={24} r={6} />
      <Ring cx={50} cy={16} r={6} />
      <Ring cx={82} cy={24} r={6} />
    </>
  ),
  // Check: a ring of sources around the answer, and a check.
  "Check.": (
    <>
      <Ring cx={50} cy={50} r={40} />
      <path d="M50 10 V22 M50 78 V90 M10 50 H22 M78 50 H90" style={line} strokeWidth={LINE} {...round} />
      <path d="M36 51 L46 61 L65 40" style={line} strokeWidth={3} {...round} />
    </>
  ),
  // See: an eye, with a star for what it sees.
  "See.": (
    <>
      <path d="M8 50 Q50 12 92 50 Q50 88 8 50Z" style={line} strokeWidth={LINE} strokeLinejoin="round" />
      <Spark cx={50} cy={50} r={17} w={2.4} />
    </>
  ),
  // Finder: a tall four-point star with the ace of spades at its heart -
  // the card that finds it (after Aditya's sketch; the ace is filled).
  knowing: (
    <>
      <path d="M50 4 Q55 40 75 50 Q55 60 50 96 Q45 60 25 50 Q45 40 50 4Z" style={line} strokeWidth={LINE} strokeLinejoin="round" />
      {/* the ace at about two-thirds size, so it sits inside the star's
          waist with room around it */}
      <path
        d="M50 38 C47 43 40.5 46.5 40.5 51.5 C40.5 55.6 44.6 57.4 47.8 55.4 L46.2 62 H53.8 L52.2 55.4 C55.4 57.4 59.5 55.6 59.5 51.5 C59.5 46.5 53 43 50 38Z"
        transform="translate(50 50) scale(0.62) translate(-50 -50)"
        style={{ fill: EDGE }}
      />
    </>
  ),
  // Decision-making - weigh options: a dotted path forking into two
  // options, every line stopping short of what it joins.
  decision: (
    <>
      <path d="M50 94 L50 67 M46.0 54.2 L33.6 36.0 M54.0 54.2 L66.4 36.0" style={line} strokeWidth={2.8} strokeDasharray="0.1 6" strokeLinecap="round" />
      <Spark cx={24} cy={22} r={13} w={2.4} />
      <Spark cx={76} cy={22} r={13} w={2.4} />
      <Ring cx={50} cy={60} r={3.5} w={2.2} />
    </>
  ),
  // Thought Coach - a half-formed idea: half drawn, half still dotted.
  thinking: (
    <>
      <path d="M50 12 A38 38 0 0 1 50 88" style={line} strokeWidth={LINE} />
      <path d="M50 12 A38 38 0 0 0 50 88" style={line} strokeWidth={2.4} strokeDasharray="3 5" strokeLinecap="round" />
      <Spark cx={50} cy={50} r={15} w={2.4} />
    </>
  ),
  // Learning - from the ground up: a tree of what you know, branching from
  // a star, 1 - 2 - 3 - 6 (after Aditya's sketch: the lines stop short of
  // each node).
  learning: (
    <>
      <Spark cx={50} cy={10} r={10} w={2.4} />
      <path d="M43.1 19.1 L37.5 26.4 M56.9 19.1 L62.5 26.4 M30.4 35.6 L19.6 49.4 M37.3 35.8 L46.7 49.2 M62.7 35.8 L53.3 49.2 M69.6 35.6 L80.4 49.4 M13.9 59.4 L7.9 75.1 M18.1 59.4 L24.1 75.1 M47.9 59.4 L41.9 75.1 M52.1 59.4 L58.1 75.1 M81.9 59.4 L75.9 75.1 M86.1 59.4 L92.1 75.1" style={line} strokeWidth={2} strokeLinecap="round" />
      <Ring cx={34} cy={31} r={3.4} w={2.2} />
      <Ring cx={66} cy={31} r={3.4} w={2.2} />
      <Ring cx={16} cy={54} r={3.4} w={2.2} />
      <Ring cx={50} cy={54} r={3.4} w={2.2} />
      <Ring cx={84} cy={54} r={3.4} w={2.2} />
      <Ring cx={6} cy={80} r={2.8} w={2} />
      <Ring cx={26} cy={80} r={2.8} w={2} />
      <Ring cx={40} cy={80} r={2.8} w={2} />
      <Ring cx={60} cy={80} r={2.8} w={2} />
      <Ring cx={74} cy={80} r={2.8} w={2} />
      <Ring cx={94} cy={80} r={2.8} w={2} />
    </>
  ),
  // Co-Creative - made together: two circles overlapping, a small spark
  // where they meet.
  creative: (
    <>
      <Ring cx={36} cy={50} r={26} />
      <Ring cx={64} cy={50} r={26} />
      <Spark cx={50} cy={50} r={7} w={2} />
    </>
  ),
  // Mentoring - guidance: a guiding star, and a path down to you.
  mentoring: (
    <>
      <Spark cx={50} cy={24} r={18} />
      <path d="M50 48 V80" style={line} strokeWidth={2.4} strokeDasharray="2 6" strokeLinecap="round" />
      <Ring cx={50} cy={86} r={4.5} w={2.4} />
    </>
  ),
  // Reflect & Relieve: a spark, a few quiet steps, and a star - from a
  // flicker of a feeling to something settled (Aditya's outline sketch).
  therapy: (
    <>
      <path d="M20 30 Q23 46 36 50 Q23 54 20 70 Q17 54 4 50 Q17 46 20 30Z" style={line} strokeWidth={2.4} strokeLinejoin="round" />
      {/* evenly across the gap between the two stars */}
      <circle cx={49} cy={50} r={2.4} style={{ fill: EDGE }} />
      <circle cx={62} cy={50} r={2.4} style={{ fill: EDGE }} />
      <circle cx={75} cy={50} r={2.4} style={{ fill: EDGE }} />
      <circle cx={88} cy={50} r={2.4} style={{ fill: EDGE }} />
      <path d="M120.0 33.0 L124.7 45.5 L138.1 46.1 L127.6 54.5 L131.2 67.4 L120.0 60.0 L108.8 67.4 L112.4 54.5 L101.9 46.1 L115.3 45.5Z" style={line} strokeWidth={2.4} strokeLinejoin="round" />
    </>
  ),
  // Legal: balanced scales, with a small star at the top.
  legal: (
    <>
      <path d="M50 14 V86 M30 86 H70 M18 30 H82" style={line} strokeWidth={LINE} strokeLinecap="round" />
      <path d="M18 30 L8 56 H28 Z M82 30 L72 56 H92 Z" style={line} strokeWidth={2.2} strokeLinejoin="round" />
      <Spark cx={50} cy={14} r={8} w={2} behind />
    </>
  ),
};

/** Drawn in a 140 x 100 box rather than a square. */
const WIDE = new Set(["therapy"]);

/** `shape`: a mode value ("knowing", "decision"...) or a step word ("Ask.").
 *  `center`: where to sit before the card has been measured, in card px.
 *  `size`: the mark's size in card px. */
export function CardEmboss({ shape, center, size }: { shape: string; center: number; size: number }) {
  const ref = useRef<SVGSVGElement>(null);

  // Midway between the text above and the text below, in this card's own
  // layout. Re-measured when its text changes size (fonts arriving, rotation).
  useLayoutEffect(() => {
    const mark = ref.current;
    const card = mark?.parentElement;
    if (!mark || !card) return;
    // Layout positions (offsetTop/offsetHeight), not screen rects: the cards
    // scale in as they're revealed, and a rect read mid-animation is off.
    const place = () => {
      const height = card.clientHeight;
      if (height === 0) return;
      let above = 0;
      let below = height;
      for (const el of card.children) {
        if (el === mark || !(el instanceof HTMLElement)) continue;
        if (!(el.textContent?.trim() || el.querySelector("img"))) continue;
        const top = el.offsetTop;
        const h = el.offsetHeight;
        if (h === 0) continue;
        if (top + h / 2 < height / 2) above = Math.max(above, top + h);
        else below = Math.min(below, top);
      }
      mark.style.top = `${(above + below) / 2}px`;
    };
    place();
    // the card has a fixed size, so watch its text too - and re-measure once
    // the web fonts arrive, which re-wraps the blurb
    const watch = new ResizeObserver(place);
    watch.observe(card);
    for (const el of card.children) if (el !== mark) watch.observe(el);
    let live = true;
    void document.fonts?.ready.then(() => live && place());
    return () => {
      live = false;
      watch.disconnect();
    };
  }, []);

  const art = SHAPES[shape];
  if (!art) return null;
  // a row of shapes needs width more than height
  const wide = WIDE.has(shape);
  return (
    <svg
      ref={ref}
      viewBox={wide ? "0 0 140 100" : "0 0 100 100"}
      aria-hidden="true"
      data-testid="card-emboss"
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 lg:hidden"
      style={{ top: center, width: wide ? size * 1.4 : size, height: size }}
    >
      {art}
    </svg>
  );
}
