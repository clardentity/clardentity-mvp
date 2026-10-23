"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { RedirectIfSignedIn } from "@/components/auth/RedirectIfSignedIn";
import { Wordmark } from "@/components/system/Wordmark";
import { authErrorMessage, useAuth } from "@/lib/auth";
import { Button, Field, Input } from "@/components/ui/primitives";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { ThemeToggle } from "@/components/system/ThemeToggle";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      // Whether this account still owes the welcome questions (and then the
      // tour) is the server's call - RequireAuth reads it and redirects.
      // replace, not push: the form is a step they have completed, and
      // leaving it in the history means one press of Back puts a sign-in
      // screen in front of someone who never signed out.
      router.replace("/start");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-[calc(var(--app-vh)*100)] items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <RedirectIfSignedIn />
      <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Wordmark />
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5 rounded-xl border border-hairline bg-surface p-6"
        >
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-ink">Log in</h1>
            <p className="text-sm text-ink-muted">Welcome back.</p>
          </div>

          {/* type="text", not "email": the administrator signs in as a
              username, and the browser's own validation on an email field
              refuses that before the form is ever submitted. inputMode keeps
              the phone keyboard the same for everyone else, and the server
              still decides what matches. */}
          <Field label="Email or username" htmlFor="email">
            <Input
              id="email"
              type="text"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="password">
            <PasswordInput
              id="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          <div className="-mt-2 text-right">
            <Link
              href="/forgot-password"
              className="text-xs text-ink-muted transition-colors hover:text-ink"
            >
              Forgot your password?
            </Link>
          </div>

          {error && (
            <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
              {error}
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            disabled={submitting}
            className="w-full"
          >
            {submitting ? "Logging in…" : "Log in"}
          </Button>

          {/* A Google sign-in here can create an account too, so the notice
              under the button says what that agrees to; the server records
              it only for an account this creates. */}
          <GoogleSignInButton label="signin_with" acceptedTerms termsNotice />

          <p className="text-center text-sm text-ink-muted">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-medium text-brand hover:underline">
              Sign up
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
