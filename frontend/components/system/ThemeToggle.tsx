"use client";

import { toggleTheme } from "@/lib/theme";
import { cx } from "@/components/ui/primitives";

/** Sun/moon switch. Shows the theme you'd switch *to*, which is the convention
 *  people read correctly - a moon means "go dark", not "you are dark".
 *
 *  Both icons are rendered and CSS keyed on [data-theme] picks one. Choosing
 *  in JS would mean the server-rendered icon is a coin flip and visibly
 *  corrects itself on hydration; this way the very first paint is right.
 */
export function ThemeToggle({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={toggleTheme}
      title="Toggle light and dark theme"
      aria-label="Toggle light and dark theme"
      className={cx(
        "rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink",
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="h-4 w-4"
      >
        <path className="theme-when-light" d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        <g className="theme-when-dark">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </g>
      </svg>
    </button>
  );
}
