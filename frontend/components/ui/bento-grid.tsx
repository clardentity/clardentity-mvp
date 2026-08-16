import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from "react";
import Link from "next/link";

import { cx } from "@/components/ui/primitives";

/* Adapted from Magic UI's bento-grid (magicui.design/docs/components/bento-grid).
 *
 * Structure and interaction are kept as designed - 3-column auto-row grid,
 * cards that stack to full width on mobile, the icon shrinking and content
 * lifting on hover to reveal a CTA. Two deviations, both deliberate:
 *
 *   - Upstream pulls in shadcn's Button and @radix-ui/react-icons. Both would
 *     be new dependencies for one component, so the CTA is a plain link and
 *     the arrow is inline SVG, matching how icons are done elsewhere here.
 *   - Upstream hardcodes bg-background / text-neutral-700, which ignores this
 *     project's token set and reads wrong in dark mode. Swapped for the
 *     surface/ink tokens so cards match every other surface in both themes.
 */

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
  children: ReactNode;
  className?: string;
  /** Row height from `sm` up, as a CSS length. Applied inline rather than as a
   *  utility class because two `auto-rows-[…]` classes have equal specificity,
   *  so which one wins comes down to CSS source order, not the order they
   *  appear in the class string - callers were silently getting the default. */
  rowHeight?: string;
}

interface BentoCardProps extends Omit<ComponentPropsWithoutRef<"div">, "title" | "onClick"> {
  name: string;
  className?: string;
  background?: ReactNode;
  Icon?: React.ElementType;
  description: string;
  /** Short label shown beside the name. A real slot rather than something the
   *  caller absolutely-positions into `background`: text pinned over flowing
   *  text has no way to know the name wrapped, so the two collide the moment
   *  the card is narrow. Flex layout can't overlap by construction. */
  eyebrow?: string;
  /** Navigation target. Mutually exclusive with onClick. */
  href?: string;
  /** For cards whose CTA performs an action (creating something) rather than
   *  going somewhere - it renders a button, so it doesn't lie to the browser
   *  about being a link. */
  onClick?: () => void;
  cta?: string;
}

export function BentoGrid({
  children,
  className,
  rowHeight = "18rem",
  ...props
}: BentoGridProps) {
  return (
    <div
      // Fixed row heights only from `sm` up. On a phone every card is full
      // width and stacked, so a fixed row just leaves dead space under short
      // copy - let content size the card instead. The media query lives in a
      // style tag rather than a class because the height is a prop.
      className={cx(
        "bento-grid grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3",
        className,
      )}
      style={{ "--bento-row-height": rowHeight } as CSSProperties}
      {...props}
    >
      {children}
    </div>
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  );
}

/** The visible call to action. Deliberately *not* interactive: the real
 *  control is an overlay covering the whole card (see below), so this is only
 *  the label for it. Two hit targets would mean two tab stops for one action,
 *  and the smaller one is only visible on hover. */
function Cta({ label }: { label: string }) {
  return (
    // Inline rather than inline-flex: as a flex row the label is one item and
    // the arrow another, so a label that wraps leaves the arrow stranded at the
    // far edge, vertically centred against two lines of text. Inline keeps it
    // attached to the last word.
    <span className="text-sm font-medium text-brand">
      {label}{" "}
      <ArrowRight className="ml-0.5 inline-block h-3.5 w-3.5 align-[-0.15em]" />
    </span>
  );
}

export function BentoCard({
  name,
  className,
  background,
  Icon,
  description,
  eyebrow,
  href,
  onClick,
  cta,
  ...props
}: BentoCardProps) {
  const interactive = Boolean((href || onClick) && cta);

  return (
    <div
      className={cx(
        "group relative flex flex-col justify-between overflow-hidden rounded-2xl",
        "border border-hairline bg-surface transition-colors hover:border-brand-border",
        className,
      )}
      {...props}
    >
      {background && <div className="pointer-events-none">{background}</div>}

      <div className="relative z-10 p-6">
        {/* The lift only happens where there's a hover CTA to reveal - on
            touch the CTA is always visible, so lifting would just jitter. */}
        <div
          className={cx(
            "pointer-events-none flex transform-gpu flex-col gap-1 transition-transform duration-300",
            interactive && "lg:group-hover:-translate-y-8",
          )}
        >
          {Icon && (
            <Icon className="mb-2 h-8 w-8 origin-left transform-gpu text-brand transition-transform duration-300 ease-in-out group-hover:scale-90" />
          )}
          {/* Above the name at every width, not beside it. Measured: a card is
              ~280px of content even on a wide screen, and "Learning Companion"
              plus "Expand your knowledge and skills" wants ~400px - so a shared
              line squeezes the name to nothing. It only looked survivable
              before because the label was absolutely positioned and simply
              printed over the name instead of admitting it didn't fit. */}
          {eyebrow && <span className="text-sm font-medium text-brand">{eyebrow}</span>}
          <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">{name}</h3>
          <p className="max-w-lg text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        </div>

        {interactive && (
          <div className="mt-3 flex flex-row items-center lg:hidden">
            <Cta label={cta!} />
          </div>
        )}
      </div>

      {interactive && (
        <div className="pointer-events-none absolute bottom-0 hidden w-full translate-y-8 transform-gpu flex-row items-center p-6 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 lg:flex">
          <Cta label={cta!} />
        </div>
      )}

      {/* The whole card is the button. Previously only the CTA was clickable,
          and on desktop that CTA is invisible until you hover - so a card that
          looks entirely like one big target did nothing for anyone who clicked
          the obvious place. The overlay carries the accessible name, and sits
          above the content so no child can swallow the click. */}
      {interactive &&
        (href ? (
          <Link href={href} aria-label={cta} className="absolute inset-0 z-20 rounded-2xl" />
        ) : (
          <button
            type="button"
            onClick={onClick}
            aria-label={cta}
            className="absolute inset-0 z-20 cursor-pointer rounded-2xl"
          />
        ))}
    </div>
  );
}
