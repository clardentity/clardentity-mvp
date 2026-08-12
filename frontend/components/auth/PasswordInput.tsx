"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Input, cx } from "@/components/ui/primitives";

/* A password field you can read back.
 *
 * Typing a password you cannot see, into a form that only tells you it was
 * wrong after you submit, is the whole reason people get locked out of
 * accounts they know the password to. The reveal is off by default and
 * reverts on every render of a fresh field, so it never leaks a password to
 * someone who walks up to an already-open screen. */
export function PasswordInput({
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input
        {...rest}
        type={visible ? "text" : "password"}
        // Room for the toggle, so a long password doesn't run underneath it.
        className={cx("pr-10", className)}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        // Off the tab path: tabbing from the password field should reach the
        // submit button, which is where someone typing is heading.
        tabIndex={-1}
        aria-label={visible ? "Hide password" : "Show password"}
        title={visible ? "Hide password" : "Show password"}
        className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center rounded-r-lg text-ink-muted transition-colors hover:text-ink"
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
          {visible ? (
            <>
              <path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.61 6.61A18.6 18.6 0 0 0 2 12s3 8 10 8a9.1 9.1 0 0 0 5.39-1.61" />
              <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
              <path d="m2 2 20 20" />
            </>
          ) : (
            <>
              <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
