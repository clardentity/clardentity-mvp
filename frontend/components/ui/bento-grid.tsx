import type { ComponentPropsWithoutRef, ReactNode } from "react";
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
}

interface BentoCardProps extends Omit<ComponentPropsWithoutRef<"div">, "title"> {
  name: string;
  className?: string;
  background?: ReactNode;
  Icon?: React.ElementType;
  description: string;
  href?: string;
  cta?: string;
}

export function BentoGrid({ children, className, ...props }: BentoGridProps) {
  return (
    <div
      // Fixed row heights only from `sm` up. On a phone every card is full
      // width and stacked, so a fixed 18rem row just leaves dead space under
      // short copy - let content size the card instead. (Note that overriding
      // an arbitrary value like auto-rows-[18rem] from a caller's className is
      // unreliable: same specificity means CSS source order decides, not the
      // order in the class string. Hence the breakpoint rather than an
      // override.)
      className={cx(
        "grid w-full grid-cols-1 gap-4 sm:auto-rows-[18rem] sm:grid-cols-2 lg:auto-rows-[20rem] lg:grid-cols-3",
        className,
      )}
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

export function BentoCard({
  name,
  className,
  background,
  Icon,
  description,
  href,
  cta,
  ...props
}: BentoCardProps) {
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
            href && cta && "lg:group-hover:-translate-y-8",
          )}
        >
          {Icon && (
            <Icon className="mb-2 h-8 w-8 origin-left transform-gpu text-brand transition-transform duration-300 ease-in-out group-hover:scale-90" />
          )}
          <h3 className="text-lg font-semibold tracking-[-0.01em] text-ink">{name}</h3>
          <p className="max-w-lg text-sm leading-relaxed text-ink-muted">
            {description}
          </p>
        </div>

        {href && cta && (
          <div className="mt-3 flex flex-row items-center lg:hidden">
            <Link
              href={href}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-brand"
            >
              {cta}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>

      {href && cta && (
        <div className="absolute bottom-0 hidden w-full translate-y-8 transform-gpu flex-row items-center p-6 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100 lg:flex">
          <Link
            href={href}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-brand"
          >
            {cta}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}
