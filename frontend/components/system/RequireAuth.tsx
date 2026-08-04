"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/system/AppShell";
import { Spinner } from "@/components/ui/primitives";

/** Gates a route on an authenticated session and wraps it in the app shell,
 *  so every signed-in page gets the sidebar/topbar while signed-out pages
 *  (landing, login, register) stay full-bleed. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  return <AppShell>{children}</AppShell>;
}
