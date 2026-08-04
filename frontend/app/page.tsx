"use client";

import Link from "next/link";
import { HealthStatus } from "@/components/system/HealthStatus";
import { useAuth } from "@/lib/auth";

const PILLARS = [
  {
    title: "Four cognitive modes",
    body: "Knowing, Thinking, Decision, and Learning. You pick the mode; the assistant never guesses which one you meant.",
  },
  {
    title: "Evidence on every claim",
    body: "Answers are split into individually-checkable claims, each scored against your own documents with the source excerpt attached.",
  },
  {
    title: "Bias screening",
    body: "Reasoning is screened against a catalogue of 437 cognitive biases, and flagged ones are named and explained rather than hidden.",
  },
];

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-hairline bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            Clardentity
          </span>
          <nav className="flex items-center gap-2 text-sm">
            {loading ? null : user ? (
              <Link
                href="/workspace"
                className="rounded-lg bg-brand px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-brand-dark"
              >
                Open workspace
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="rounded-lg px-3 py-1.5 text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
                >
                  Log in
                </Link>
                <Link
                  href="/register"
                  className="rounded-lg bg-brand px-3.5 py-1.5 font-medium text-white transition-colors hover:bg-brand-dark"
                >
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-16">
        <div className="max-w-2xl">
          <h1 className="text-4xl font-semibold tracking-tight text-ink">
            Answers you can audit.
          </h1>
          <p className="mt-3 text-lg leading-relaxed text-ink-secondary">
            Clardentity is a cognitive layer over your documents. Every answer is
            broken into claims, grounded in cited evidence, scored for confidence,
            and screened for the cognitive biases that quietly distort reasoning.
          </p>

          {!loading && (
            <div className="mt-7 flex flex-wrap gap-2">
              <Link
                href={user ? "/workspace" : "/register"}
                className="rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-dark"
              >
                {user ? "Go to your workspaces" : "Get started"}
              </Link>
              <Link
                href={user ? "/biases" : "/login"}
                className="rounded-lg border border-hairline-strong bg-surface px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-surface-hover"
              >
                {user ? "Browse the bias library" : "Log in"}
              </Link>
            </div>
          )}
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-3">
          {PILLARS.map((p) => (
            <section
              key={p.title}
              className="rounded-xl border border-hairline bg-surface p-5"
            >
              <h2 className="text-sm font-semibold text-ink">{p.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{p.body}</p>
            </section>
          ))}
        </div>

        <div className="mt-10 max-w-sm">
          <HealthStatus />
        </div>
      </main>
    </div>
  );
}
