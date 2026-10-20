"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { RequireAuth } from "@/components/system/RequireAuth";
import { StartChat } from "@/components/chat/StartChat";
import { Spinner } from "@/components/ui/primitives";

/** Where the installed app opens (app/manifest.ts, start_url).
 *
 *  Signed in: a new chat, by the same road sign-in takes (/start, which
 *  opens the workspace's empty chat or makes one). Signed out: the home page
 *  at clardentity.ai, not the login form - someone opening the app from
 *  their home screen without an account should see what it is, with the
 *  demo a tap away. /start alone could not do the second: it is behind
 *  RequireAuth, which sends a signed-out visitor to /login. */
export default function LaunchPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/");
  }, [loading, user, router]);

  if (user) {
    return (
      <RequireAuth>
        <StartChat />
      </RequireAuth>
    );
  }
  return (
    <div className="flex min-h-[calc(var(--app-vh)*100)] items-center justify-center">
      <Spinner className="text-ink-muted" />
    </div>
  );
}
