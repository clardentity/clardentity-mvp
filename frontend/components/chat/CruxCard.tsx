"use client";

/** The model's own one-sentence bottom line - the first and, for most
 *  readers, the only thing they read of an answer. Not itself collapsible:
 *  it's the summary the fold exists to sit under, so it has to already be
 *  visible for the fold to make sense. No heading, either; the frame does the
 *  work of saying "this is the content" (a gradient hairline, a brand-tinted
 *  glow, larger type and a single sheen pass when it arrives), and a label on
 *  top of it read as a second title competing with the mode. */
export function CruxCard({ text }: { text: string }) {
  return (
    <div className="gist-card mb-2.5">
      <div className="gist-card-inner px-3.5 py-3">
        {/* Parked off-canvas (and never animated) under prefers-reduced-motion
            - see globals.css. */}
        <span aria-hidden="true" className="gist-sheen" />
        <div className="flex items-start gap-2.5">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            className="mt-[3px] h-4 w-4 shrink-0 text-brand"
          >
            {/* Four-point spark: the "here's the point" mark. */}
            <path d="M12 2c.4 4.8 3.2 7.6 8 8-4.8.4-7.6 3.2-8 8-.4-4.8-3.2-7.6-8-8 4.8-.4 7.6-3.2 8-8z" />
            <path d="M19 15c.2 2 1.3 3.1 3.3 3.3-2 .2-3.1 1.3-3.3 3.3-.2-2-1.3-3.1-3.3-3.3 2-.2 3.1-1.3 3.3-3.3z" opacity="0.6" />
          </svg>
          <p className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}
