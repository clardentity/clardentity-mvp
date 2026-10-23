"use client";

import Link from "next/link";
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
 *  rather than showing a button that can only fail.
 *
 *  `acceptedTerms` is sent with the token: a Google sign-in can create the
 *  account, and the server records the agreement only when told. While
 *  `disabledHint` is set the button isn't drawn at all - Google's button is
 *  an iframe, which can't be disabled - and the hint stands in its place. */
export function GoogleSignInButton({
  label,
  acceptedTerms = false,
  disabledHint,
  termsNotice = false,
}: {
  label: "signin_with" | "signup_with";
  acceptedTerms?: boolean;
  disabledHint?: string;
  /** For a page with no terms box (log in): says under the button that a
   *  new account made through it agrees to the terms. */
  termsNotice?: boolean;
}) {
  const router = useRouter();
  const { refresh } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scriptReady, setScriptReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Read at the moment the credential arrives, so ticking the box doesn't
  // re-initialise Google's client.
  const acceptedRef = useRef(acceptedTerms);
  useEffect(() => {
    acceptedRef.current = acceptedTerms;
  }, [acceptedTerms]);
  const disabled = Boolean(disabledHint);

  const handleCredential = useCallback(
    async (response: CredentialResponse) => {
      if (!response.credential) return;
      setError(null);
      try {
        const res = await fetch(`${API_BASE_URL}/auth/oauth/google`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id_token: response.credential,
            accepted_terms: acceptedRef.current,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.detail ?? `Sign-in failed (${res.status})`);
        }
        const tokens = await res.json();
        setTokens(tokens.access_token, tokens.refresh_token);
        await refresh();
        // replace, not push - see the note in the login page.
        router.replace("/start");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Google sign-in failed");
      }
    },
    [router, refresh],
  );

  useEffect(() => {
    if (!CLIENT_ID || !scriptReady || disabled || !containerRef.current) return;
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
    // `disabled`: the container is new each time the button comes back.
  }, [scriptReady, handleCredential, label, disabled]);

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

      {disabled ? (
        <p className="text-center text-sm text-ink-muted">{disabledHint}</p>
      ) : (
        <div ref={containerRef} className="flex justify-center" />
      )}

      {termsNotice && !disabled && (
        <p className="text-center text-xs leading-relaxed text-ink-muted">
          New to Clardentity? Continuing with Google creates an account, and
          means you agree to the{" "}
          <Link href="/terms" target="_blank" className="text-brand hover:underline">
            Terms of Service
          </Link>{" "}
          and the{" "}
          <Link href="/privacy" target="_blank" className="text-brand hover:underline">
            Privacy Policy
          </Link>
          .
        </p>
      )}

      {error && (
        <p className="text-center text-sm text-band-low" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
