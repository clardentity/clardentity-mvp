"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/system/ThemeToggle";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/auth/password-reset/request", {
        method: "POST",
        body: { email },
      });
      setSent(true);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink">
            Clardentity
          </Link>
        </div>

        {sent ? (
          // Deliberately not "we sent it to that address" - the API doesn't
          // say whether an account exists, and neither should this screen.
          <div className="space-y-4 rounded-xl border border-hairline bg-surface p-6">
            <h1 className="text-xl font-semibold text-ink">Check your email</h1>
            <p className="text-sm leading-relaxed text-ink-muted">
              If <span className="font-medium text-ink">{email}</span> has an
              account, a link to choose a new password is on its way. It works
              once and expires in 30 minutes.
            </p>
            <p className="text-sm leading-relaxed text-ink-muted">
              Nothing arriving? Check the spam folder, then{" "}
              <button
                type="button"
                onClick={() => setSent(false)}
                className="font-medium text-brand hover:underline"
              >
                try another address
              </button>
              .
            </p>
            <Link
              href="/login"
              className="block text-center text-sm font-medium text-brand hover:underline"
            >
              Back to log in
            </Link>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="space-y-5 rounded-xl border border-hairline bg-surface p-6"
          >
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-ink">Forgot your password?</h1>
              <p className="text-sm text-ink-muted">
                Enter your email and we&apos;ll send you a link to choose a new one.
              </p>
            </div>

            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>

            {error && (
              <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" disabled={submitting} className="w-full">
              {submitting ? "Sending…" : "Send reset link"}
            </Button>

            <p className="text-center text-sm text-ink-muted">
              Remembered it?{" "}
              <Link href="/login" className="font-medium text-brand hover:underline">
                Log in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
