"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MaskIcon } from "@/components/ui/MaskIcon";
import { CurtainShimmer } from "@/components/marketing/CurtainShimmer";
import { GuestDemo } from "@/components/marketing/GuestDemo";
import { HeroComposer } from "@/components/marketing/HeroComposer";
import { Reveal } from "@/components/marketing/Reveal";
import { CardEmboss } from "@/components/marketing/CardEmboss";
import { track } from "@/lib/analytics";

/* The landing page, built from the Figma design (file mTefBk432edigQvPwag6mK,
 * node 69:7). Every measurement, colour and asset here came from the design
 * over the Figma connector rather than from a screenshot, so the layout is
 * the design's own numbers.
 *
 * Three things about how it is built:
 *
 * The design is a fixed 1728px canvas. Rather than reproduce that with
 * absolute positioning - which would be pixel-perfect at exactly one width
 * and broken at every other - each section keeps the design's intrinsic
 * sizes and centres them in flow. At 1728px the result matches the frame;
 * below it, the content scales down through `clamp` on the display type and
 * the grids reflow. Nothing about the design is lost, and it survives a
 * phone.
 *
 * The revision this is built from took the whole page down to 90.25% - every
 * box, to the digit: the content column from 1110 to 1001.775, the mode
 * cards from 300x400 to 270.75x361, the stage from 1144 to 1032.46 - so the
 * page sits in more of its own margin. The nav is the exception; it was
 * added at full size, and keeps the 32px wordmark the rest of the page has
 * stepped down from.
 *
 * The palette reads through to the app's tokens rather than being written out
 * here. The hexes these used to hold were the burgundy's, to the digit - but
 * an account that has chosen another accent should find this page in it once
 * they are signed in, and a page holding its own copy of the colour can only
 * ever be burgundy. The one exception is the curtain, which is a photograph
 * of burgundy fabric and stays what it is.
 */

const INK = "var(--text)"; // headings
const INK_BODY = "var(--text-secondary)"; // body copy under a heading
const MUTED = "var(--text-muted)"; // captions, eyebrow text, footer wordmark
const PLUM = "var(--brand)"; // accent: send button, "Ask./Check./See.", emphasis
const CANVAS = "var(--surface-muted)";
const HAIRLINE = "var(--border-strong)"; // card borders
const OUTLINE = "var(--text-nav)"; // the nav pill

/* Where the curtain sits inside the stage, shared by the base image and the
 * shimmer copy laid over it so the two can never drift apart.
 *
 * This used to be a window onto a 4096px master - 116.8% wide at -8.4%,
 * 150.96% tall at -50.96% - because the asset was the whole photograph and
 * the stage showed a band of it. The design now supplies that band already
 * cropped, so the picture simply fills the frame; the 0.04% of overscan is
 * the design's own, and keeps a subpixel seam off the edges. */
const CURTAIN_GEOMETRY: React.CSSProperties = {
  left: "-0.02%",
  top: 0,
  width: "100.04%",
  height: "100%",
  maxWidth: "none",
};

/* A twenty-pixel-wide copy of the curtain as the blur-up placeholder. The
 * stage is the first thing on the page: without this the hero is an empty
 * dark box until the image arrives. 450 bytes inline costs less than one
 * round trip. */
const CURTAIN_BLUR =
  "data:image/jpeg;base64,/9j/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCAAJABQDASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAAEFBv/EAB4QAAEEAgMBAAAAAAAAAAAAAAEAAgQRAxIFQVGx/8QAFgEBAQEAAAAAAAAAAAAAAAAABAAB/8QAGREAAgMBAAAAAAAAAAAAAAAAAAIBBBFB/9oADAMBAAIRAxEAPwDAw87cUgOyXrrrfio8hNiujFmADZzQ0gfVFQrBKWXRJSOjJJq+hSEkLQ+n/9k=";

type Mode = {
  name: string;
  /** What the backend calls this mode. Not derivable from the label - the
   *  pill says "Thought Coach" and the API says `thinking`. */
  value: string;
  blurb: string;
  icon: string;
  /** The white-on-dark variant used inside the hero composer. */
  heroIcon: string;
  /** The design gives every blurb its own text box rather than a shared
   *  column, and the wrapping is part of the look - "Facts, sources," breaks
   *  before "fast." because its box is 81px wide, not 227px. Carried here so
   *  the cards read exactly as drawn. */
  blurbWidth: number;
  /** Where that box starts. Two-line blurbs sit lower than three-line ones so
   *  that every card's text ends on the same baseline. */
  blurbTop: number;
};

/* Names and one-liners are the design's. "Reflect & Relieve" uses the
 * ampersand in both places - the hero pill in Figma still reads "Reflect and
 * Relieve", and the client asked for the ampersand, which is also what the
 * product itself calls the mode. */
const MODES: Mode[] = [
  {
    name: "Finder",
    value: "knowing",
    blurb: "Facts, sources, fast.",
    icon: "/landing/icon-card-finder.svg",
    heroIcon: "/landing/icon-hero-finder.svg",
    blurbWidth: 81.177,
    blurbTop: 258.48,
  },
  {
    name: "Decision-making",
    value: "decision",
    blurb: "Weigh options against what matters to you.",
    icon: "/landing/icon-card-decision.svg",
    heroIcon: "/landing/icon-hero-decision.svg",
    blurbWidth: 208.853,
    blurbTop: 258.48,
  },
  {
    name: "Thought Coach",
    value: "thinking",
    blurb: "Sort out a half-formed idea.",
    icon: "/landing/icon-card-thought.svg",
    heroIcon: "/landing/icon-hero-thought.svg",
    blurbWidth: 221.329,
    blurbTop: 285.56,
  },
  {
    name: "Learning",
    value: "learning",
    blurb: "Learn it from the ground up.",
    icon: "/landing/icon-card-learning.svg",
    heroIcon: "/landing/icon-hero-learning.svg",
    blurbWidth: 221.329,
    blurbTop: 285.56,
  },
  {
    name: "Co-Creative",
    value: "creative",
    blurb: "Make something together, draft by draft.",
    icon: "/landing/icon-card-cocreative.svg",
    heroIcon: "/landing/icon-hero-cocreative.svg",
    blurbWidth: 221.329,
    blurbTop: 258.48,
  },
  {
    name: "Mentoring",
    value: "mentoring",
    blurb: "Guidance on a skill or a career.",
    icon: "/landing/icon-card-mentoring.svg",
    heroIcon: "/landing/icon-hero-mentoring.svg",
    blurbWidth: 143.449,
    blurbTop: 258.48,
  },
  {
    name: "Reflect & Relieve",
    value: "therapy",
    blurb: "A calm place to think through how you feel.",
    icon: "/landing/icon-card-reflect.svg",
    heroIcon: "/landing/icon-hero-reflect.svg",
    blurbWidth: 164.098,
    blurbTop: 258.48,
  },
  {
    name: "Legal",
    value: "legal",
    blurb: "Plain-language help with legal questions.",
    icon: "/landing/icon-card-legal.svg",
    heroIcon: "/landing/icon-hero-legal.svg",
    blurbWidth: 161.768,
    blurbTop: 258.48,
  },
];

const STEPS = [
  {
    word: "Ask.",
    blurb: "Your question goes to the models best suited for it.",
    blurbWidth: 256,
    blurbLeft: 25.68,
  },
  {
    word: "Check.",
    blurb: "The answer is split into claims & checked against sources.",
    blurbWidth: 276.894,
    blurbLeft: 25.27,
  },
  // Narrower in the design than the other two, which is what gives this one
  // its own line break rather than the shared column's.
  {
    word: "See.",
    blurb: "You get the answer and the facts audited.",
    blurbWidth: 240.634,
    blurbLeft: 25.27,
  },
];

/* One mark, painted. There used to be four copies of this file with four
 * different fills baked in, which meant the mark was the one part of the page
 * that could not follow an accent - and three of the four were the same shape
 * in a different colour anyway.
 *
 * The whole lockup is driven by one number. The design draws it twice - 32px
 * with a 33.083 x 32 mark and a 12px gap in the nav, 28.88px with a 29.857 x
 * 28.88 mark and a 10.83px gap everywhere else - and those are the same
 * shape: 1.0338 and 0.375 of the type size, both times. Sizing the mark and
 * the gap in `em` says that once, and it is what lets the size be a clamp:
 * the nav's 32px is most of a phone's width, and the mark has to come down
 * with the word rather than sit beside a smaller one. */
function Wordmark({
  size,
  tone,
  mark,
}: {
  /** Any CSS length - a number of px, or a clamp() for the ones that have to
   *  survive a narrow screen. */
  size: string | number;
  tone: string;
  /** The dots, which are not always the colour of the word beside them. */
  mark: string;
}) {
  return (
    <span
      className="flex shrink-0 items-center"
      style={{ fontSize: size, gap: "0.375em" }}
    >
      <span style={{ color: mark }} className="flex">
        <MaskIcon
          src="/landing/logo-dots.svg"
          style={{ width: "1.0338em", height: "1em" }}
        />
      </span>
      <span className="whitespace-nowrap font-normal leading-none" style={{ color: tone }}>
        Clardentity
      </span>
    </span>
  );
}

/* The nav was added at full size; the rest of the page stepped down to
 * 90.25%. Both hold their design size on a wide screen and give way on a
 * narrow one. */
const NAV_WORDMARK = "clamp(22px, 2.2vw, 32px)";
const PAGE_WORDMARK = "clamp(20px, 2vw, 28.88px)";

export function LandingPage({ signedIn }: { signedIn: boolean }) {
  const enter = signedIn ? "/start" : "/register";

  /* The try-it-here demo, and the rectangle it grows out of. Held here
     rather than inside the composer because the panel covers the page, not
     the stage - it is a sibling of the whole layout, mounted only while it
     is open so none of its state outlives a close. */
  const stageRef = useRef<HTMLDivElement>(null);
  const [demo, setDemo] = useState<{ mode: string; label: string; origin: DOMRect | null } | null>(
    null,
  );

  /* The page is light by design, whatever theme the browser is in. The
     element below paints its own canvas, but the document behind it does
     not - so an overscroll bounce, or the browser chrome on a phone, showed
     the app's black behind a cream page. Writing to document.body is a
     side effect on something outside React, which is what an effect is for;
     it is undone on the way out so the app's own theme is untouched. */
  useEffect(() => {
    const previous = document.body.style.backgroundColor;
    document.body.style.backgroundColor = CANVAS;
    return () => {
      document.body.style.backgroundColor = previous;
    };
  }, []);

  return (
    <div
      className="landing min-h-[calc(var(--app-vh)*100)] w-full font-[family-name:var(--font-outfit)]"
      // line-height: normal, inherited by everything inside. The design sets
      // every text node to CSS `normal` (about 1.2 for Outfit); Tailwind's
      // `leading-normal` is 1.5, which is a different number and re-wraps
      // every fixed-width text box in the design - "Facts, sources, fast."
      // fell onto four lines instead of three.
      style={{ background: CANVAS, color: INK, lineHeight: "normal" }}
    >
      {/* ---------------------------------------------------------------- */}
      {/* Hero (69:8) */}
      {/* ---------------------------------------------------------------- */}
      <section className="relative mx-auto w-full max-w-[1728px] px-4 pb-[40px] pt-[48px] sm:px-8 sm:pb-[80px] sm:pt-[82px]">
        {/* The nav (116:1908). The wordmark used to be centred over the page
            with the way in pinned to the right of it, which left the two
            halves of the bar unrelated to each other. They are now the ends
            of one row: the name on the left, the door on the right. */}
        <nav className="mx-auto flex w-full max-w-[1351px] flex-wrap items-center justify-between gap-4">
          <Link href="/" aria-label="Clardentity">
            <Wordmark size={NAV_WORDMARK} tone={INK} mark={PLUM} />
          </Link>
          <span className="flex items-center gap-4 sm:gap-5">
            {/* The way back, for someone who already has an account. Only
                when they are signed out: offering "Log in" to a signed-in
                visitor reads as having been signed out, which is the
                confusion the Back button used to cause outright. Quiet, and
                to the left, because the page is addressed to people who
                have not signed up yet - this is for the minority who have,
                and who were previously told only to start exploring. */}
            {!signedIn && (
              <Link
                href="/login"
                className="transition-opacity hover:opacity-70"
                style={{ color: OUTLINE, fontSize: "clamp(15px, 1.5vw, 20px)" }}
              >
                Log in
              </Link>
            )}
            <Link
              // Someone who is already signed in and lands here - which is
              // where Back from the app now goes - must not be offered a login
              // button. It reads as having been signed out, which is the same
              // confusion the back button used to cause outright. The design's
              // wording is the way out of that: "Start exploring" is true of
              // both, and goes wherever that person's next step actually is.
              href={enter}
              className="inline-flex items-center rounded-[37px] border px-[12px] py-[4px] transition-colors hover:bg-black/[0.03]"
              style={{ borderColor: OUTLINE, color: OUTLINE, fontSize: "clamp(16px, 1.65vw, 24px)" }}
            >
              Start exploring
            </Link>
          </span>
        </nav>

        <div className="mx-auto mt-[96px] flex w-full max-w-[1032.46px] flex-col items-center sm:mt-[171px]">
          <h1
            className="w-full text-center font-normal"
            style={{ fontSize: "clamp(20px, 2.35vw, 28px)", color: INK }}
          >
            Every answer, checked claim by claim.
          </h1>

          {/* The stage. 1032.46 x 445.835 in the design; the ratio is kept so
              the curtain never crops differently from the frame, and the box
              is a container so everything inside can be sized against its
              width rather than the viewport's. */}
          <div className="mt-[14.44px] w-full overflow-hidden rounded-[14.44px]">
            <div
              ref={stageRef}
              className="relative w-full"
              // aspect-ratio and containerType in a style object: see the
              // note on the crop below for why fractional values do not go
              // through Tailwind's arbitrary-value syntax on this page.
              style={{ aspectRatio: "1032.46 / 445.835", containerType: "inline-size" }}
            >
              {/* Geometry in a style object, not Tailwind arbitrary values:
                  negative percentage insets and fractional percentage sizes
                  are the class shapes this project has repeatedly found are
                  emitted as class names and then never generated as CSS -
                  the element carries the class and lays out as though it
                  did not. Inline leaves nothing to chance. */}
              <Image
                src="/landing/curtain-stage.webp"
                alt=""
                width={1909}
                height={824}
                priority
                placeholder="blur"
                blurDataURL={CURTAIN_BLUR}
                sizes="(max-width: 1200px) 100vw, 1100px"
                className="absolute"
                // maxWidth is explicit in CURTAIN_GEOMETRY because the base
                // stylesheet caps every img at 100% of its container, which
                // would undo the overscan.
                style={CURTAIN_GEOMETRY}
              />
              {/* Under the design's own darkening gradient, so the light
                  behaves like part of the photograph rather than something
                  painted over the finished frame. */}
              <CurtainShimmer style={CURTAIN_GEOMETRY} />
              <div
                aria-hidden="true"
                className="absolute inset-0"
                style={{
                  backgroundImage:
                    "linear-gradient(110.13deg, rgba(0,0,0,0.4) 27.018%, rgba(0,0,0,0) 83.189%)",
                }}
              />

              {/* The composer, sunk into the lower half of the stage exactly
                  as the design places it (centre + 86.19px of a 445.835px
                  stage, which is 19.332% and so travels with it).

                  Drawn at its true size - 834.813px wide, the design's
                  number - and then scaled by however much the stage itself
                  has been scaled. Everything inside therefore keeps its exact
                  proportions at any width: at 1032.46px the scale is 1 and
                  this is the design pixel for pixel; on a phone the whole
                  composer shrinks together rather than the eight mode pills
                  overflowing a box that got narrower while they did not. */}
              <div
                className="absolute left-1/2"
                style={{
                  width: 834.813,
                  top: "calc(50% + 19.332%)",
                  // Divided by a *length*, so the result is the unitless
                  // ratio scale() needs - dividing by the bare number
                  // 1032.46 yields a length, which scale() rejects silently.
                  transform: "translate(-50%, -50%) scale(calc(100cqi / 1032.46px))",
                }}
              >
                <HeroComposer
                  modes={MODES}
                  accent={PLUM}
                  onOpen={(mode) => {
                    track("guest_demo_opened", { mode: mode.value });
                    setDemo({
                      mode: mode.value,
                      label: mode.name,
                      origin: stageRef.current?.getBoundingClientRect() ?? null,
                    });
                  }}
                />
              </div>
            </div>
          </div>

          <p
            className="mt-[36px] w-full text-center font-semibold uppercase"
            style={{ fontSize: "clamp(14px, 1.2vw, 20px)", color: MUTED }}
          >
            <Link href={enter} className="transition-colors hover:text-brand">
              Start asking
            </Link>
            {" · "}
            <a href="#how-it-works" className="transition-colors hover:text-brand">
              See how it works
            </a>
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* How it works (69:132) */}
      {/* ---------------------------------------------------------------- */}
      {/* Second now, not fourth. The design stacks it directly under the
          hero, which is also where the hero's own "See how it works" has
          always pointed - the link used to jump the reader over two sections
          to reach it. */}
      <section
        id="how-it-works"
        className="mx-auto w-full max-w-[1728px] scroll-mt-8 px-4 py-[72px] sm:px-8 sm:py-[126px]"
      >
        <div className="mx-auto flex w-full max-w-[1059.23px] flex-col items-center gap-[26.371px]">
          <Reveal as="h2" className="text-center font-normal capitalize">
            <span style={{ fontSize: "clamp(25px, 2.8vw, 35.161px)", color: INK }}>
              How it works
            </span>
          </Reveal>

          <div className="grid w-full grid-cols-1 justify-items-center gap-[35.161px] md:grid-cols-3">
            {STEPS.map((step, i) => (
              <Reveal
                as="article"
                key={step.word}
                // Ask, then Check, then See - in that order, which is the
                // point the three cards are making.
                delay={i * 110}
                className="landing-card relative h-[439.515px] w-full max-w-[329.636px] overflow-hidden rounded-[13.185px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[13.185px]"
                  // Fractional border width inline for the same reason as the
                  // hero crop: the arbitrary-value class rounds to 1px
                  // because the rule is never generated.
                  style={{ border: `1.099px solid ${HAIRLINE}` }}
                />
                {/* phone only: a small outlined mark in the empty middle */}
                <CardEmboss shape={step.word} center={249} size={86} />
                <p
                  className="absolute font-normal"
                  style={{
                    left: step.blurbLeft,
                    top: 28.94,
                    width: step.blurbWidth,
                    fontSize: 24,
                    color: MUTED,
                  }}
                >
                  {step.blurb}
                </p>
                <div
                  className="absolute left-1/2 flex -translate-x-1/2 items-center justify-between"
                  style={{ bottom: 24.72, width: 276.894 }}
                >
                  <span
                    className="whitespace-nowrap font-semibold"
                    style={{ fontSize: 36, color: PLUM }}
                  >
                    {step.word}
                  </span>
                  <span style={{ color: HAIRLINE }} className="flex">
                    <MaskIcon
                      src="/landing/logo-dots.svg"
                      className="h-[35.161px] w-[36.351px]"
                    />
                  </span>
                </div>
              </Reveal>
            ))}
          </div>

          <Reveal as="p" delay={160} className="text-right font-normal uppercase">
            <span style={{ fontSize: "clamp(14px, 1.25vw, 20px)", color: MUTED }}>
              Clardentity uses multiple AI models, not just one.
            </span>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* The audit (69:66) */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto flex w-full max-w-[1728px] items-center px-4 py-[72px] sm:px-8 sm:py-[126px]">
        <div className="mx-auto w-full max-w-[1001.775px]">
          <Reveal className="flex items-center justify-between">
            <Wordmark size={PAGE_WORDMARK} tone={INK} mark={PLUM} />
            <p
              className="whitespace-nowrap text-center font-semibold uppercase"
              style={{ fontSize: "clamp(13px, 1.1vw, 18px)", color: MUTED }}
            >
              The audit
            </p>
          </Reveal>

          <Reveal as="h2" delay={90} className="mt-[3.61px] text-center font-normal">
            <span style={{ fontSize: "clamp(36px, 5vw, 86px)", color: INK }}>
              An answer is many claims.
            </span>
          </Reveal>
          <Reveal delay={180} className="mt-[3.61px] max-w-[769.429px] font-normal">
            <div style={{ fontSize: "clamp(16px, 1.7vw, 28px)", color: INK_BODY }}>
              <p>Clardentity splits every answer into individual claims.</p>
              <p>Each one is checked against sources. You see what holds up and what doesn&apos;t.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Modes (69:77) */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-[1728px] px-4 py-[60px] sm:px-8">
        <div className="mx-auto flex w-full max-w-[1172.35px] flex-col items-end gap-[16px]">
          <Reveal as="h2" className="w-full max-w-[330.315px] text-right font-normal capitalize">
            <span style={{ fontSize: "clamp(20px, 2.35vw, 28px)", color: INK }}>
              <span style={{ color: PLUM }}>Different questions</span> need{" "}
              <span style={{ color: PLUM }}>different thinking.</span>
            </span>
          </Reveal>

          {/* Four across at the design's width, reflowing below it. The cards
              keep their 270.75 x 361 shape, so the wall of them reads the
              same at every breakpoint. */}
          <div className="grid w-full grid-cols-1 justify-items-center gap-x-[28.88px] gap-y-[36.1px] sm:grid-cols-2 lg:grid-cols-4">
            {MODES.map((mode, i) => (
              <Reveal
                as="article"
                key={mode.name}
                // Staggered across the row, capped so the second row does not
                // wait most of a second behind the first.
                delay={(i % 4) * 70}
                className="landing-card relative h-[361px] w-full max-w-[270.75px] overflow-hidden rounded-[10.83px]"
              >
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 rounded-[10.83px]"
                  style={{ border: `0.902px solid ${HAIRLINE}` }}
                />
                {/* phone only: a small outlined mark in the empty middle */}
                <CardEmboss shape={mode.value} center={155} size={70} />
                <div
                  className="absolute flex items-center justify-between"
                  style={{ left: 20.76, top: 23.47, width: 227.43 }}
                >
                  <h3
                    className="whitespace-nowrap font-semibold"
                    style={{ fontSize: 18, color: INK }}
                  >
                    {mode.name}
                  </h3>
                  <Image
                    src={mode.icon}
                    alt=""
                    width={29}
                    height={29}
                    className="block"
                    style={{ width: 28.88, height: 28.88 }}
                  />
                </div>
                <p
                  className="absolute font-normal"
                  style={{
                    left: 20.76,
                    top: mode.blurbTop,
                    width: mode.blurbWidth,
                    fontSize: 21.66,
                    color: MUTED,
                  }}
                >
                  {mode.blurb}
                </p>
              </Reveal>
            ))}
          </div>

          <Reveal as="p" delay={120} className="w-full text-right font-semibold uppercase">
            <span style={{ fontSize: "clamp(13px, 1.1vw, 18px)", color: MUTED }}>
              Switch modes yourself, or let Clardentity pick.
            </span>
          </Reveal>
        </div>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Closing call to action (69:153) */}
      {/* ---------------------------------------------------------------- */}
      <section className="mx-auto w-full max-w-[1728px] px-4 pb-[90px] pt-[90px] sm:px-8 xl:px-[160px]">
        <Reveal className="flex flex-col items-start justify-between gap-10 xl:flex-row xl:items-center">
          <div className="flex w-full max-w-[1001.775px] flex-col gap-[10.83px]">
            <h2
              className="font-semibold"
              style={{ fontSize: "clamp(36px, 5vw, 86.64px)", color: INK }}
            >
              See what holds up.
            </h2>
            <Link href={enter} className="group flex items-start self-start">
              <span
                className="whitespace-nowrap font-medium uppercase underline decoration-dotted transition-colors group-hover:text-brand"
                style={{ fontSize: "clamp(18px, 1.8vw, 28.88px)", color: MUTED }}
              >
                Start asking
              </span>
              <Image
                src="/landing/arrow-up-right.svg"
                alt=""
                width={36}
                height={36}
                className="block"
                style={{ width: 36.1, height: 36.1 }}
              />
            </Link>
          </div>
          <Wordmark size={PAGE_WORDMARK} tone={MUTED} mark={MUTED} />
        </Reveal>
      </section>

      {demo && (
        <GuestDemo
          origin={demo.origin}
          modes={MODES}
          initialMode={demo.mode}
          onClose={() => setDemo(null)}
        />
      )}

      {/* The legal pages are a requirement of the terms people accept at
          sign-up, so they need a route from the public page. Not in the
          design; kept quiet at the very bottom rather than added to it. */}
      <footer className="mx-auto w-full max-w-[1728px] px-4 pb-10 sm:px-8 xl:px-[160px]">
        <p className="text-sm" style={{ color: MUTED }}>
          <Link href="/privacy" className="hover:underline">
            Privacy
          </Link>
          {" · "}
          <Link href="/terms" className="hover:underline">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}
