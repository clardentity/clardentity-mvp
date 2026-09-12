"use client";

/* A rabbit in a pocket, and one word. Nothing about *what* is being done -
 * no phases, no rotating verbs, no reasoning lens - is shown while an answer
 * is being written; the work happens under the hood and the gist arrives
 * when it's ready. The mascot exists so a few seconds of waiting have
 * something alive to look at rather than a spinner.
 *
 * `label` is for the two moments that aren't generation ("Opening the
 * chat"); left out, it says Thinking. */

function Rabbit({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <g className="rabbit-head">
        {/* Ears: outer in the avatar's skin tone, inner in a brand tint. */}
        <g className="rabbit-ear-l">
          <ellipse cx="12.5" cy="7.5" rx="2.4" ry="6" transform="rotate(-14 12.5 13)"
            fill="var(--avatar-skin)" stroke="var(--avatar-skin-shade)" strokeWidth="0.8" />
          <ellipse cx="12.5" cy="8" rx="1.1" ry="4" transform="rotate(-14 12.5 13)"
            fill="var(--brand)" opacity="0.35" />
        </g>
        <g className="rabbit-ear-r">
          <ellipse cx="19.5" cy="7.5" rx="2.4" ry="6" transform="rotate(14 19.5 13)"
            fill="var(--avatar-skin)" stroke="var(--avatar-skin-shade)" strokeWidth="0.8" />
          <ellipse cx="19.5" cy="8" rx="1.1" ry="4" transform="rotate(14 19.5 13)"
            fill="var(--brand)" opacity="0.35" />
        </g>
        <circle cx="16" cy="17.5" r="6.6" fill="var(--avatar-skin)"
          stroke="var(--avatar-skin-shade)" strokeWidth="0.8" />
        <circle cx="13.6" cy="16.8" r="0.95" fill="var(--text)" />
        <circle cx="18.4" cy="16.8" r="0.95" fill="var(--text)" />
        <path d="M15 19.4h2l-1 1.1z" fill="var(--brand)" opacity="0.8" />
        {/* Whiskers */}
        <path d="M9.5 18.2h2.6M9.6 19.8l2.5-.5M22.5 18.2h-2.6M22.4 19.8l-2.5-.5"
          stroke="var(--avatar-skin-shade)" strokeWidth="0.6" strokeLinecap="round" />
      </g>
      {/* Pocket, drawn last so the rabbit sits inside it. */}
      <path d="M5 20.5h22v4.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"
        fill="var(--brand-soft)" stroke="var(--brand-border)" strokeWidth="1" />
      <path d="M7.5 22.8h17" stroke="var(--brand-border)" strokeWidth="0.8"
        strokeDasharray="1.6 1.4" strokeLinecap="round" />
    </svg>
  );
}

export function ThinkingIndicator({
  label,
  compact = false,
}: {
  label?: string | null;
  /** Inside an answer bubble under the gist, rather than standing alone. */
  compact?: boolean;
}) {
  const text = label ?? "Thinking";
  return (
    <p
      className={
        compact
          ? "flex items-center gap-1.5 text-xs text-ink-muted"
          : "flex items-center gap-2 text-sm text-ink-muted"
      }
      role="status"
      aria-label={text}
    >
      <Rabbit className={compact ? "h-5 w-5 shrink-0" : "h-7 w-7 shrink-0"} />
      <span>
        {text}
        <span className="animate-pulse">…</span>
      </span>
    </p>
  );
}
