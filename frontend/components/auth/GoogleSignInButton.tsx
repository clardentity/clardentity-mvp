"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE_URL } from "@/lib/apiClient";
import { setTokens, useAuth } from "@/lib/auth";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

type CredentialResponse = { credential?: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: CredentialResponse) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

/** Renders nothing at all when NEXT_PUBLIC_GOOGLE_CLIENT_ID is unset, so the
 *  auth pages stay clean until Google credentials are actually configured
 *  rather than showing a button that can only fail. */
export function GoogleSignInButton({ label }: { label: "signin_with" | "signup_with" }) {
  const router = useRouter();
  const { refresh } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) return;
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/auth/oauth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: response.credential }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail ?? `Sign-in failed (${res.status})`);
        }
        const tokens = await res.json();
        setTokens(tokens.access_token, tokens.refresh_token);
        await refresh();
        router.push("/workspace?enter=1");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Google sign-in failed");
      }
    },
    [router, refresh],
  );

  useEffect(() => {
    if (!CLIENT_ID || !scriptReady || !containerRef.current) return;
    const google = window.google;
    if (!google) return;

    google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: handleCredential,
    });
    google.accounts.id.renderButton(containerRef.current, {
      theme: "outline",
      size: "large",
      width: 320,
      text: label,
      shape: "pill",
    });
  }, [scriptReady, handleCredential, label]);

  if (!CLIENT_ID) return null;

  return (
    <div className="space-y-3">
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={() => setScriptReady(true)}
      />

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-hairline" />
        <span className="text-xs text-ink-muted">or</span>
        <span className="h-px flex-1 bg-hairline" />
      </div>

      <div ref={containerRef} className="flex justify-center" />

      {error && (
        <p className="text-center text-sm text-band-low" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
