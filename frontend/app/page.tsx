"use client";

import Link from "next/link";
import { HealthStatus } from "@/components/system/HealthStatus";
import { useAuth } from "@/lib/auth";

export default function Home() {
  const { user, loading } = useAuth();

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <main className="w-full max-w-lg space-y-8 text-center">
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight">
            Clardentity
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Validated, mode-aware, citation-backed conversations.
          </p>
        </div>

        {!loading && (
          <Link
            href={user ? "/workspace" : "/register"}
            className="inline-block rounded-md bg-brand px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-dark"
          >
            {user ? "Go to your workspaces" : "Get started"}
          </Link>
        )}

        <HealthStatus />
      </main>
    </div>
  );
}
