"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { API_BASE_URL, ApiError, apiFetch } from "@/lib/apiClient";
import { trackServerWait } from "@/lib/serverWait";

const ACCESS_TOKEN_KEY = "clardentity_access_token";
const REFRESH_TOKEN_KEY = "clardentity_refresh_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  sessionListeners.forEach((fn) => fn());
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionListeners.forEach((fn) => fn());
}

const sessionListeners = new Set<() => void>();

function subscribeStoredSession(onChange: () => void) {
  sessionListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    sessionListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Whether this browser holds a session at all - known synchronously, before
 *  `/auth/me` has confirmed it. The landing page uses it to show "Open" the
 *  instant a returning user arrives: waiting for the round trip meant up to
 *  a minute of "Log in" on a cold backend, which read as having been logged
 *  out. If the token turns out to be dead, hydrate() clears it and this
 *  flips back on its own. Server snapshot is false so the signed-out HTML
 *  stays the default for a fresh visitor. */
export function useHasStoredSession(): boolean {
  return useSyncExternalStore(
    subscribeStoredSession,
    () => getRefreshToken() !== null,
    () => false,
  );
}

type TokenResponse = { access_token: string; refresh_token: string };

/** Only the server saying "these credentials are not valid" should end a
 *  session. A network failure means we do not know - and this backend sleeps
 *  when idle, so a first request that times out is the ordinary case, not the
 *  rare one. Treating the two alike signed people out for opening the app. */
function isCredentialRejection(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

/** No answer at all, or the platform's "not up yet" (502/503/504): worth
 *  waiting on. Anything else is an answer, and retrying won't change it. */
function isServerNotReady(error: unknown): boolean {
  if (error instanceof ApiError) return error.status === 502 || error.status === 503 || error.status === 504;
  return error instanceof TypeError;
}

let inFlightRefresh: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const res = await trackServerWait(
          fetch(`${API_BASE_URL}/auth/refresh`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ refresh_token: refreshToken }),
          }),
          (r) => r.status < 500,
        );
        if (!res.ok) {
          // A 502 from a container still booting is not a rejected token.
          if (res.status === 401 || res.status === 403) clearTokens();
          return null;
        }
        const data = (await res.json()) as TokenResponse;
        setTokens(data.access_token, data.refresh_token);
        return data.access_token;
      } catch {
        return null;
      } finally {
        inFlightRefresh = null;
      }
    })();
  }

  return inFlightRefresh;
}

export type User = {
  id: string;
  email: string;
  display_name: string | null;
  /** null = the first-run welcome questions haven't been answered or
   *  skipped yet, and RequireAuth routes to /welcome. Optional (not just
   *  nullable) so a client deployed ahead of the backend that added this
   *  field sees `undefined` and gates nothing, rather than sending every
   *  signed-in user to a page that can't complete yet. */
  onboarding_completed_at?: string | null;
  /** Whether this account may open /admin. Computed by the server from its
   *  configured list; optional so a client deployed ahead of the backend
   *  that added it simply shows no link. Hiding the link is a courtesy, not
   *  the control - the admin endpoints check on every request. */
  is_admin?: boolean;
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName: string | undefined,
    /** The tick on the sign-up form. The server will not create an account
     *  without it, so it is a required argument rather than an option. */
    acceptedTerms: boolean,
  ) => Promise<void>;
  logout: () => void;
  /** Redeem a reset link and sign in on the new password in one step. */
  completePasswordReset: (token: string, password: string) => Promise<void>;
  /** Re-read the signed-in user. Used after an external flow (Google
   *  sign-in) has written tokens directly. */
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!getRefreshToken()) {
        setLoading(false);
        return;
      }
      // Phone layout: a server still waking gets a minute before the app
      // gives up on it. Going straight to the login form after one failed
      // request made a cold start look like being signed out; the waking
      // notice explains the wait meanwhile. Desktop keeps the single try.
      const phone = window.matchMedia("(max-width: 1023.98px)").matches;
      const deadline = Date.now() + 60_000;
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            // a retry must reach the server, not the short GET cache
            const me = await apiFetch<User>("/auth/me", { fresh: attempt > 0 });
            if (!cancelled) setUser(me);
            return;
          } catch (error) {
            // Keep the tokens when the backend simply could not be reached: the
            // next load, once it is awake, restores the session instead of
            // presenting a login form to someone who never logged out.
            if (isCredentialRejection(error)) {
              clearTokens();
              return;
            }
            if (!phone || !isServerNotReady(error) || cancelled || Date.now() > deadline) return;
            await new Promise((r) => setTimeout(r, 3000));
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const tokens = await apiFetch<TokenResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    setTokens(tokens.access_token, tokens.refresh_token);
    const me = await apiFetch<User>("/auth/me");
    setUser(me);
  }, []);

  const register = useCallback(
    async (email: string, password: string, displayName: string | undefined, acceptedTerms: boolean) => {
      const result = await apiFetch<TokenResponse & { user: User }>(
        "/auth/register",
        {
          method: "POST",
          // The server refuses without it; sent explicitly rather than
          // defaulted so the tick on the form is what causes it.
          body: {
            email,
            password,
            display_name: displayName || undefined,
            accepted_terms: acceptedTerms,
          },
        },
      );
      setTokens(result.access_token, result.refresh_token);
      setUser(result.user);
    },
    [],
  );

  const logout = useCallback(() => {
    clearTokens();
    setUser(null);
  }, []);

  const completePasswordReset = useCallback(async (token: string, password: string) => {
    const tokens = await apiFetch<TokenResponse>("/auth/password-reset/confirm", {
      method: "POST",
      body: { token, password },
    });
    setTokens(tokens.access_token, tokens.refresh_token);
    setUser(await apiFetch<User>("/auth/me"));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setUser(await apiFetch<User>("/auth/me"));
    } catch (error) {
      // Same rule on an explicit refresh: a failed round trip is not grounds
      // for throwing away a session that was working a moment ago.
      if (isCredentialRejection(error)) {
        clearTokens();
        setUser(null);
      }
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, completePasswordReset, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}

/** A network failure has no server message, so `fetch` supplies its own -
 *  "Failed to fetch" - and showing that to a user tells them nothing they can
 *  act on. It is also the single most likely error this app produces: the
 *  backend sleeps when idle and the first request after a quiet spell can take
 *  the better part of a minute, which the browser gives up on. Name that. */
export function networkErrorMessage(err: unknown): string | null {
  const message = err instanceof Error ? err.message : "";
  const isNetwork =
    err instanceof TypeError ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(message);
  return isNetwork
    ? "Couldn't reach the server. It may be waking up after being idle - try again in a moment."
    : null;
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: string } | null)?.detail;
    return detail ?? err.message;
  }
  return networkErrorMessage(err) ?? (err instanceof Error ? err.message : "Something went wrong");
}
