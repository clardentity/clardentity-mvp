"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { API_BASE_URL, ApiError, apiFetch } from "@/lib/apiClient";

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
}

export function clearTokens(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

type TokenResponse = { access_token: string; refresh_token: string };

let inFlightRefresh: Promise<string | null> | null = null;

export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;

  if (!inFlightRefresh) {
    inFlightRefresh = (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!res.ok) {
          clearTokens();
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
};

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
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
      try {
        const me = await apiFetch<User>("/auth/me");
        if (!cancelled) setUser(me);
      } catch {
        clearTokens();
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
    async (email: string, password: string, displayName?: string) => {
      const result = await apiFetch<TokenResponse & { user: User }>(
        "/auth/register",
        {
          method: "POST",
          body: { email, password, display_name: displayName || undefined },
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
    } catch {
      clearTokens();
      setUser(null);
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

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const detail = (err.body as { detail?: string } | null)?.detail;
    return detail ?? err.message;
  }
  return err instanceof Error ? err.message : "Something went wrong";
}
