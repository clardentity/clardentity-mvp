"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/lib/useReducedMotion";

/* The composer on the stage, demonstrating itself.
 *
 * It used to type a rotating list of questions into a box while the eight
 * mode pills sat underneath, all identical and all inert. That showed what
 * you can ask but not the thing the product is actually about - that the
 * question picks the companion. A question about a tenancy agreement with
 * none of the eight lit is a search box with decoration under it.
 *
 * Now the mode and the question arrive together: a pill lights, its question
 * types itself out, both clear, and another mode takes over. One full pass
 * covers all eight, so anyone who watches long enough has seen the range.
 *
 * The order is shuffled rather than left to right. Left to right reads as a
 * list being recited, and whichever mode happened to be eighth would almost
 * never be seen - a visitor watches three or four of these, not a minute of
 * them.
 */

type HeroMode = { name: string; value: string; heroIcon: string };

/* One question per mode, chosen so that the pairing is self-evident - the
 * point is for someone to read the question, see which pill is lit, and
 * understand the relationship without a line of copy explaining it. */
const QUESTION_BY_MODE: Record<string, string> = {
  // The design's own question, and the mode that answers it. First, so the
  // first paint is the design.
  Finder: "Are we alone in this universe?",
  "Decision-making": "Should I take the job in Singapore or stay?",
  "Thought Coach": "Help me think through whether to go back to study.",
  Learning: "Explain the Krebs cycle for a Class 10 student.",
  "Co-Creative": "Draft a one-page proposal for a community library.",
  Guidance: "How do I get from junior to lead in two years?",
  Healthcare: "What does a high LDL on my blood test mean?",
  Legal: "What does my tenancy agreement actually oblige me to do?",
};

/* Quicker than a single question on its own needed to be. There are eight of
 * these now, and a loop nobody reaches the end of is a loop that may as well
 * hold three modes. */
const TYPE_MS = 38; // per character, typing
const DELETE_MS = 18; // per character, clearing - faster, as it always is
const HOLD_MS = 1100; // applied twice: once on the full line, once before clearing
const BETWEEN_MS = 260; // on an empty box, before the next mode takes over

type Phase = "typing" | "holding" | "deleting";

/** Fisher-Yates on a copy. */
function shuffle(items: number[]): number[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function HeroComposer({
  modes,
  accent,
  onOpen,
}: {
  modes: readonly HeroMode[];
  accent: string;
  /** Clicking the box hands over whichever companion was lit at that moment,
   *  so the demo opens in the mode the visitor was actually watching. */
  onOpen?: (mode: HeroMode) => void;
}) {
  const reducedMotion = usePrefersReducedMotion();

  /* Which mode sits in each slot of the current pass, and how far through it
     we are. Both in one piece of state because they only ever change
     together, and state rather than a ref because the render reads them.

     It starts in declaration order, which matters: a shuffle in a lazy
     initialiser would run on the server and again on the client and pick a
     different first pill each time, which React reports as a hydration
     error. Every reshuffle below happens inside a timeout - after hydration
     by definition. */
  const [cycle, setCycle] = useState<{ order: number[]; step: number; shuffled: boolean }>(() => ({
    order: modes.map((_, i) => i),
    step: 0,
    shuffled: false,
  }));
  const [length, setLength] = useState(() => QUESTION_BY_MODE[modes[0]?.name ?? ""]?.length ?? 0);
  const [phase, setPhase] = useState<Phase>("holding");

  const active = cycle.order[cycle.step] ?? 0;
  const question = QUESTION_BY_MODE[modes[active]?.name ?? ""] ?? "";

  useEffect(() => {
    if (reducedMotion) return;

    if (phase === "typing") {
      if (length >= question.length) {
        const t = setTimeout(() => setPhase("holding"), HOLD_MS);
        return () => clearTimeout(t);
      }
      const t = setTimeout(() => setLength((n) => n + 1), TYPE_MS);
      return () => clearTimeout(t);
    }

    if (phase === "holding") {
      const t = setTimeout(() => setPhase("deleting"), HOLD_MS);
      return () => clearTimeout(t);
    }

    if (length <= 0) {
      const t = setTimeout(() => {
        const next = cycle.step + 1;
        /* shuffle() is called here, in the timeout, and never inside a state
           updater - an updater has to be pure, and React may run it twice. */
        if (next >= modes.length) {
          // A fresh pass in a fresh order, including which mode opens it, so
          // a second loop does not replay the first.
          setCycle({ order: shuffle(modes.map((_, i) => i)), step: 0, shuffled: true });
        } else if (!cycle.shuffled) {
          // The first pass keeps Finder in front for the design's sake and
          // shuffles only what follows it.
          setCycle({
            order: [cycle.order[0], ...shuffle(cycle.order.slice(1))],
            step: next,
            shuffled: true,
          });
        } else {
          setCycle({ ...cycle, step: next });
        }
        setPhase("typing");
      }, BETWEEN_MS);
      return () => clearTimeout(t);
    }

    const t = setTimeout(() => setLength((n) => n - 1), DELETE_MS);
    return () => clearTimeout(t);
  }, [reducedMotion, phase, length, cycle, question, modes]);

  const text = reducedMotion ? question : question.slice(0, length);

  /* Phone: the pills are one row that scrolls sideways (globals.css,
     .hero-pills), so the lit one is brought into view as the demo moves
     on - by moving the row, never the page. */
  const pillsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = pillsRef.current;
    const pill = row?.children[active] as HTMLElement | undefined;
    if (!row || !pill || row.scrollWidth <= row.clientWidth) return;
    const left = pill.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, left), behavior: reducedMotion ? "auto" : "smooth" });
  }, [active, reducedMotion]);

  return (
    // The hero-* classes are the phone layout (globals.css): there the
    // composer is drawn at a readable size instead of scaled down with the
    // stage, which put its text at about 7px on a 375px screen.
    <div className="hero-composer flex flex-col" style={{ gap: 11.732 }}>
      {/* A button, not a picture of one. The box has been typing questions
          at the visitor; the least surprising thing it can do when clicked
          is let them type their own. */}
      <button
        type="button"
        onClick={() => onOpen?.(modes[active])}
        aria-label={`Try Clardentity in ${modes[active]?.name ?? "Finder"} mode`}
        className="hero-box group relative w-full cursor-text overflow-hidden rounded-[18.05px] border text-left transition-colors hover:border-white/40"
        style={{
          height: 111.91,
          background: "rgba(255,255,255,0.1)",
          borderColor: "var(--border)",
        }}
      >
        <p
          className="hero-text absolute whitespace-nowrap font-normal text-white"
          style={{ left: 23.47, top: 22.33, fontSize: 18.05 }}
        >
          {text}
          {!reducedMotion && (
            // Blinks only while the line sits finished; steady while
            // characters are moving, which is how a caret behaves in a real
            // text box.
            <span className="landing-caret" data-blinking={phase === "holding" ? "true" : "false"} />
          )}
        </p>
        <span
          className="hero-send absolute flex items-center justify-center rounded-[19.855px]"
          style={{
            bottom: 13.76,
            right: 19.86,
            width: 28.88,
            height: 28.88,
            background: accent,
          }}
        >
          <Image
            src="/landing/arrow-up.svg"
            alt=""
            width={18}
            height={18}
            className="block"
            style={{ width: 18.05, height: 18.05 }}
          />
        </span>
      </button>

      <div ref={pillsRef} className="hero-pills flex items-center justify-between" style={{ gap: 3.61 }}>
        {modes.map((mode, i) => {
          const lit = i === active;
          return (
            <span
              key={mode.name}
              className="hero-pill flex shrink-0 flex-col items-center justify-center rounded-[7.22px] border transition-[background-color,border-color,opacity] duration-300"
              style={{
                gap: 3.61,
                paddingLeft: 10.83,
                paddingRight: 10.83,
                paddingTop: 3.61,
                paddingBottom: 3.61,
                // The lit pill is the design's pill; the others are the same
                // pill turned down. Dimming the rest rather than brightening
                // one keeps the row looking like the drawing when a pill is
                // selected, which is the state it was drawn in.
                background: lit ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.07)",
                borderColor: lit ? "rgba(255,255,255,0.6)" : "var(--border)",
                opacity: lit ? 1 : 0.5,
              }}
            >
              <Image
                src={mode.heroIcon}
                alt=""
                width={18}
                height={18}
                className="hero-pill-icon block"
                style={{ width: 18.05, height: 18.05 }}
              />
              <span
                className="hero-pill-label whitespace-nowrap font-normal text-white"
                style={{ fontSize: 14.44 }}
              >
                {mode.name}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
