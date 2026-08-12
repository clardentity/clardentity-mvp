"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { authErrorMessage, useAuth } from "@/lib/auth";
import { Button, Field } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { ThemeToggle } from "@/components/system/ThemeToggle";

function ResetPasswordForm() {
  const { completePasswordReset } = useAuth();
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const mismatch = confirm.length > 0 && password !== confirm;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token || mismatch) return;
    setError(null);
    setSubmitting(true);
    try {
      await completePasswordReset(token, password);
      // Straight in, rather than back to a login form to retype what was just
      // chosen. The reset endpoint returns tokens for exactly this reason.
      router.push("/workspace?enter=1");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="space-y-4 rounded-xl border border-hairline bg-surface p-6">
        <h1 className="text-xl font-semibold text-ink">This link is incomplete</h1>
        <p className="text-sm leading-relaxed text-ink-muted">
          Reset links carry a token that isn&apos;t in this URL - it was probably
          clipped by an email client. Requesting a fresh one takes a moment.
        </p>
        <Link
          href="/forgot-password"
          className="block text-center text-sm font-medium text-brand hover:underline"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-5 rounded-xl border border-hairline bg-surface p-6"
    >
      <div className="space-y-1">
        <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
        <p className="text-sm text-ink-muted">
          You&apos;ll be signed in once it&apos;s saved.
        </p>
      </div>

      <Field label="New password" htmlFor="password" hint="At least 8 characters.">
        <PasswordInput
          id="password"
          required
          minLength={8}
          autoComplete="new-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      <Field label="Confirm new password" htmlFor="confirm">
        <PasswordInput
          id="confirm"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      {mismatch && (
        // Said while typing rather than on submit: the whole point of a
        // confirm field is to catch the typo before it becomes a lockout.
        <p className="text-sm text-band-low">These two don&apos;t match yet.</p>
      )}

      {error && (
        <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        disabled={submitting || mismatch || password.length < 8}
        className="w-full"
      >
        {submitting ? "Saving…" : "Save and sign in"}
      </Button>

      <p className="text-center text-sm text-ink-muted">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink">
            Clardentity
          </Link>
        </div>
        {/* useSearchParams needs a Suspense boundary to prerender this route. */}
        <Suspense fallback={null}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
