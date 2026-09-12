"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { startTour } from "@/lib/tour";
import { Button, Spinner, Textarea, cx } from "@/components/ui/primitives";
import { ThemeToggle } from "@/components/system/ThemeToggle";

/* Three open-ended questions, shown once, right after sign-up (or on the
 * first sign-in after this shipped). Every one is optional and the whole
 * thing can be skipped - what's typed here is evidence for the same profile
 * inference that reads the user's conversations, not a form that fills
 * fields, so nothing depends on it being answered. The tour begins when this
 * page is finished or skipped, which is why it starts here and nowhere else. */

const QUESTIONS = [
  {
    title: "What brings you to Clardentity?",
    hint: "A sentence or two about what you're hoping to get done here.",
    placeholder: "e.g. I keep making big decisions on gut feel and want a second opinion that shows its evidence.",
  },
  {
    title: "What are you working on, studying, or deciding right now?",
    hint: "Whatever's actually on your plate - work, study, a decision you're weighing.",
    placeholder: "e.g. Comparing two job offers, and revising for a statistics exam in November.",
  },
  {
    title: "How do you like information delivered?",
    hint: "Short and direct? Step by step? Evidence up front? Anything that helps match your pace.",
    placeholder: "e.g. Give me the bottom line first, then the reasoning if I ask.",
  },
] as const;

export default function WelcomePage() {
  const { user, loading, refresh } = useAuth();
  const router = useRouter();
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => QUESTIONS.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed-out users go to login; already-onboarded ones have no business
  // here and go straight in. `=== null` for the same reason as RequireAuth:
  // an older backend omits the field, and that must not trap anyone.
  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (user.onboarding_completed_at !== null) router.replace("/workspace?enter=1");
  }, [loading, user, router]);

  async function finish(skipAll: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      await apiFetch("/profile/onboarding", {
        method: "POST",
        body: {
          answers: QUESTIONS.map((q, i) => ({
            question: q.title,
            answer: skipAll ? "" : answers[i].trim(),
          })),
        },
      });
      // Re-read the user so RequireAuth sees the stamp and stops sending
      // people back here, then hand over to the tour.
      await refresh();
      // Force: an account-level reset must re-show the tour even in a
      // browser that dismissed it before.
      startTour("workspace", { force: true });
      router.replace("/workspace?enter=1");
    } catch {
      setError("That didn't save. Check your connection and try again.");
      setSubmitting(false);
    }
  }

  if (loading || !user || user.onboarding_completed_at !== null) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  const q = QUESTIONS[page];
  const isLast = page === QUESTIONS.length - 1;
  const firstName = (user.display_name || "").trim().split(/\s+/)[0];

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
      <ThemeToggle className="absolute right-4 top-4 sm:right-6 sm:top-6" />
      <div className="w-full max-w-lg">
        <div className="mb-6 text-center">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink">
            Clardentity
          </Link>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLast) void finish(false);
            else setPage((p) => p + 1);
          }}
          className="space-y-5 rounded-xl border border-hairline bg-surface p-6"
        >
          <div className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
              {page === 0
                ? `Welcome${firstName ? `, ${firstName}` : ""}`
                : `Question ${page + 1} of ${QUESTIONS.length}`}
            </p>
            <h1 className="text-xl font-semibold text-ink">{q.title}</h1>
            <p className="text-sm text-ink-muted">{q.hint}</p>
          </div>

          <Textarea
            // Remounted per page (key), so autoFocus lands the caret in each
            // new question without a ref/effect dance.
            key={page}
            autoFocus
            rows={4}
            value={answers[page]}
            onChange={(e) =>
              setAnswers((prev) => prev.map((a, i) => (i === page ? e.target.value : a)))
            }
            placeholder={q.placeholder}
            maxLength={2000}
            aria-label={q.title}
          />

          <ol className="flex items-center justify-center gap-2" aria-label="Progress">
            {QUESTIONS.map((_, i) => (
              <li
                key={i}
                aria-current={i === page ? "step" : undefined}
                className={cx(
                  "h-1.5 rounded-full transition-all",
                  i === page ? "w-6 bg-brand" : "w-1.5 bg-hairline-strong",
                )}
              />
            ))}
          </ol>

          {error && (
            <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void finish(true)}
              disabled={submitting}
              className="text-xs text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
            >
              Skip for now
            </button>
            <div className="flex items-center gap-2">
              {page > 0 && (
                <Button type="button" variant="ghost" onClick={() => setPage((p) => p - 1)} disabled={submitting}>
                  Back
                </Button>
              )}
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? "Saving…" : isLast ? "Finish" : "Continue"}
              </Button>
            </div>
          </div>

          <p className="text-center text-xs text-ink-muted">
            All optional. This is only used to give your profile a head start - it
            keeps learning from how you actually use Clardentity.
          </p>
        </form>
      </div>
    </div>
  );
}
