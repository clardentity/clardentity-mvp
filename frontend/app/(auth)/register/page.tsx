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

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await register(email, password, displayName, acceptedTerms);
      // RequireAuth routes a not-yet-onboarded account to /welcome from
      // here; the tour starts when those questions are finished or skipped.
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
            <h1 className="text-xl font-semibold text-ink">Create an account</h1>
            <p className="text-sm text-ink-muted">Takes about a minute.</p>
          </div>

          <Field
            label={
              <>
                Name <span className="font-normal text-ink-muted">(optional)</span>
              </>
            }
            htmlFor="displayName"
          >
            <Input
              id="displayName"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>

          <Field label="Email" htmlFor="email">
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>

          <Field label="Password" htmlFor="password" hint="At least 8 characters.">
            <PasswordInput
              id="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {/* Unticked by default and required to submit. A pre-ticked box is
              not consent in any jurisdiction that has thought about it, and
              the two links open the documents rather than describing them. */}
          <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-relaxed text-ink-secondary">
            <input
              type="checkbox"
              required
              checked={acceptedTerms}
              onChange={(e) => setAcceptedTerms(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
            />
            <span>
              I agree to the{" "}
              <Link href="/terms" target="_blank" className="text-brand hover:underline">
                Terms of Service
              </Link>{" "}
              and the{" "}
              <Link href="/privacy" target="_blank" className="text-brand hover:underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>

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
            {submitting ? "Creating account…" : "Sign up"}
          </Button>

          {/* Held back until the box above is ticked: a Google sign-up
              creates the account in one tap, so the agreement has to come
              first, the same as for the form. */}
          <GoogleSignInButton
            label="signup_with"
            acceptedTerms={acceptedTerms}
            disabledHint={
              acceptedTerms
                ? undefined
                : "Tick the box above to sign up with Google."
            }
          />

          <p className="text-center text-sm text-ink-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-brand hover:underline">
              Log in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
