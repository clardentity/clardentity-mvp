"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { WordRotator } from "@/components/marketing/WordRotator";
import { ModeFlipCarousel } from "@/components/marketing/ModeFlipCarousel";

/* Positioning is deliberately indirect: it names the failure modes people
   already recognise in assistants that answer confidently and can't be
   checked, without naming any product and without describing how any of this
   is actually done. No counts or metrics either - a number invites a
   comparison, and the claim here is about kind, not quantity. */

function Nav({ signedIn }: { signedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-12 w-full max-w-5xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link href="/" className="shrink-0 text-[15px] font-semibold tracking-tight text-ink">
          Clardentity
        </Link>
        {/* whitespace-nowrap throughout: at 320px "Log in" broke across two
            lines and pushed the header to 96px tall, which is a third of the
            fold spent on chrome. */}
        <nav className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[13px] sm:gap-1">
          <ThemeToggle className="mr-1" />
          {signedIn ? (
            <Link
              href="/workspace"
              className="rounded-full bg-brand px-4 py-1.5 font-medium text-white transition-colors hover:bg-brand-dark"
            >
              Open
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-2 py-1.5 text-ink-secondary transition-colors hover:text-ink sm:px-3"
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-brand px-3 py-1.5 font-medium text-white transition-colors hover:bg-brand-dark sm:px-4"
              >
                Get started
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export default function Home() {
  // Deliberately not gated on `loading`. This is a public page, so signed-out
  // is the right default: gating the calls to action on an auth check meant
  // the server-rendered HTML shipped with no sign-up or sign-in link at all,
  // and a visitor with a stale token sat looking at a landing page with no way
  // in until the auth request came back - up to a minute on a cold backend.
  const { user } = useAuth();
  const primaryHref = user ? "/workspace" : "/register";
  const primaryLabel = user ? "Open your workspace" : "Get started";

  return (
    <div className="bg-canvas">
      <Nav signedIn={!!user} />

      {/* Hero ------------------------------------------------------------
          Deliberately compact, not the full-height opener it used to be: at
          normal viewport heights the old pt-32/pb-20 padding alone pushed the
          mode carousel below the fold, so reaching it meant scrolling past a
          screen of nothing but hero before seeing what the product actually
          does. Tightened so the carousel's first row is visible without
          scrolling on an ordinary laptop screen. */}
      <section className="px-5 pb-4 pt-8 text-center sm:px-6 sm:pb-6 sm:pt-12">
        {/* The name is three words folded together, which nobody gets from
            reading it once. Rotating them in the eyebrow slot says so without
            a sentence explaining the pun; the line under it gives the meaning
            as an assembly - the parts, then what they add up to - because
            spelled out as prose ("clarity on the facts of the identity of an
            entity") it reads like a mission statement and nobody finishes it.
            Both lines stay short on purpose: the rotator cannot wrap, so a
            long phrase in that slot would overflow a 320px screen. */}
        <p className="flex flex-wrap items-center justify-center gap-x-2 text-sm font-semibold uppercase tracking-widest text-ink-muted">
          <span>Clardentity is</span>
          <WordRotator
            words={["clarity", "identity", "entity"]}
            className="text-brand"
          />
        </p>
        <p className="mx-auto mt-3 max-w-md text-balance text-[13px] leading-relaxed text-ink-muted sm:text-sm">
          <span className="text-ink-secondary">clarity</span>
          {" + "}
          <span className="text-ink-secondary">identity</span>
          {" + "}
          <span className="text-ink-secondary">entity</span>
          {" : the facts of who or what, made checkable."}
        </p>

        {/* The forced break is a desktop composition - on a phone it turns
            an already-large heading into three lines that fill the fold
            before the sentence explaining the product is even reached. */}
        <h1 className="mx-auto mt-4 max-w-4xl text-[2rem] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl sm:leading-[1.05] lg:text-7xl">
          Your lifelong
          <br className="hidden sm:inline" />{" "}
          wise companion.
        </h1>
        {/* Wording from the client's linguistic recommendations. Their copy
            uses an em dash here; house rule converts it to a hyphen. */}
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-ink-secondary sm:mt-4 sm:text-lg lg:text-xl">
          Most AI sounds certain. Clardentity doesn&apos;t just give answers -
          it shows you the evidence, and admits when there isn&apos;t any.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:mt-6">
          <Link
            href={primaryHref}
            className="rounded-full bg-brand px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-brand-dark"
          >
            {primaryLabel}
          </Link>
          <Link
            href="#modes"
            className="text-[15px] font-medium text-brand transition-opacity hover:opacity-70"
          >
            See how it helps ›
          </Link>
        </div>
      </section>

      {/* Seven modes - the centrepiece, and now the first thing after the
          hero. It used to sit behind the problem statement, which meant a
          visitor read two screens of argument before seeing what the thing
          does. The case for it lands better once you know what it is. */}
      <section id="modes" className="scroll-mt-16 pb-20 pt-2 sm:pb-24 sm:pt-4">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-widest text-brand">
              One companion. Seven modes of companionship.
            </p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl">
              You decide how it helps.
            </h2>
            <p className="mt-3 text-lg leading-relaxed text-ink-secondary">
              Different questions deserve a different approach. You choose the
              mode - Clardentity never assumes. Tap a card to see what it does.
            </p>
          </div>
        </div>

        <div className="mt-6 sm:mt-8">
          <ModeFlipCarousel />
        </div>
      </section>

      {/* The problem, named without naming anyone --------------------------- */}
      <section className="border-y border-hairline bg-surface px-6 py-20 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-3xl lg:text-4xl">
            An answer you can&apos;t verify
            <br />
            is just a confident assumption.
          </p>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-ink-secondary">
            Fluent writing creates the illusion of authority. That&apos;s the
            dangerous trap. When every reply uses the same confident voice, the
            reliable and the unreliable look identical.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-lg font-medium leading-relaxed text-ink">
            Clardentity removes the illusion.
          </p>
        </div>
      </section>

      {/* Auditing --------------------------------------------------------- */}
      <section className="border-y border-hairline bg-surface px-6 py-24">
        <div className="mx-auto grid max-w-5xl items-center gap-14 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl">
              Every claim,
              <br />
              openly audited.
            </h2>
            <p className="mt-5 text-lg leading-relaxed text-ink-secondary">
              Answers arrive broken into individual claims. Each one is checked
              against your own documents and scored on its own merits - so a
              solid answer with one weak link shows you exactly which link.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-ink-secondary">
              Reasoning is screened for the cognitive biases that quietly bend a
              conclusion. When one shows up, it&apos;s named and explained,
              never buried.
            </p>
          </div>

          {/* A representative answer, not a screenshot: it stays legible at
              any width and can't drift out of date with the real UI. */}
          <div className="rounded-3xl border border-hairline bg-canvas p-6">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Knowing
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-band-high-border bg-band-high-bg px-2 py-0.5 text-[11px] font-medium text-band-high">
                <span className="h-1.5 w-1.5 rounded-full bg-band-high" />
                Likely Fact
              </span>
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-ink">
              The renewal deadline is 15 March 2027
              <span className="mx-0.5 rounded border border-brand-border bg-brand-soft px-1 align-super text-[10px] font-semibold text-brand">
                1
              </span>
              , and notice must be given sixty days before that date
              <span className="mx-0.5 rounded border border-brand-border bg-brand-soft px-1 align-super text-[10px] font-semibold text-brand">
                1
              </span>
              .
            </p>
            <div className="mt-4 rounded-xl border border-hairline bg-surface p-3">
              <p className="text-[11px] font-medium text-ink">[1] agreement.pdf</p>
              <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
                &ldquo;The current term ends on March 15, 2027. Renewal is
                automatic unless either party gives written notice at least 60
                days before the term end date.&rdquo;
              </p>
            </div>
            <div className="mt-2 rounded-xl border border-caution-border bg-caution-bg p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-caution">
                Possible bias · Anchoring
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-caution opacity-90">
                Judging the price against the figure you saw first, rather than
                what the thing is independently worth.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Memory ----------------------------------------------------------- */}
      <section className="px-6 py-24">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl">
            It remembers you.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-ink-secondary">
            Most conversations start from nothing, every time. This one builds
            an understanding of how you think, what you&apos;re working on, and
            the roles you actually occupy in your life - and gets more useful
            the longer you use it.
          </p>
          <p className="mx-auto mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
            That picture is yours to read, correct, or delete outright,
            whenever you like.
          </p>
        </div>
      </section>

      {/* Close ------------------------------------------------------------ */}
      <section className="border-t border-hairline bg-surface px-6 py-24 text-center">
        <h2 className="mx-auto max-w-2xl text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-4xl lg:text-5xl">
          Start with a question.
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-lg leading-relaxed text-ink-secondary">
          No setup, no tour. Sign in and ask - your workspace is already there.
        </p>
        <Link
          href={primaryHref}
          className="mt-9 inline-block rounded-full bg-brand px-6 py-3 text-[15px] font-medium text-white transition-colors hover:bg-brand-dark"
        >
          {primaryLabel}
        </Link>
      </section>

      <footer className="border-t border-hairline px-6 py-10">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 text-[13px] text-ink-muted">
          <span>Clardentity</span>
          <span>Validated, mode-aware, citation-backed conversations.</span>
        </div>
      </footer>
    </div>
  );
}
