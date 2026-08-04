"use client";

import { useEffect, useState } from "react";
import { BACKEND_ROOT_URL } from "@/lib/apiClient";

type DependencyStatus = "ok" | "error";

type HealthResponse = {
  status: DependencyStatus;
  dependencies: Record<string, DependencyStatus>;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; data: HealthResponse }
  | { kind: "error"; message: string };

export function HealthStatus() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    fetch(`${BACKEND_ROOT_URL}/health`)
      .then(async (res) => {
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setState({ kind: "loaded", data });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ kind: "error", message: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-xl border border-hairline bg-surface p-4 text-left">
      <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Backend connectivity
      </h2>

      {state.kind === "loading" && (
        <p className="text-sm text-ink-muted">Checking…</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-band-low">
          Could not reach the backend at {BACKEND_ROOT_URL} ({state.message})
        </p>
      )}

      {state.kind === "loaded" && (
        <ul className="space-y-1.5">
          {Object.entries(state.data.dependencies).map(([name, status]) => (
            <li key={name} className="flex items-center justify-between text-sm">
              <span className="capitalize text-ink-secondary">{name}</span>
              <span className="flex items-center gap-1.5 font-medium">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    status === "ok" ? "bg-band-high" : "bg-band-low"
                  }`}
                  aria-hidden="true"
                />
                <span className={status === "ok" ? "text-band-high" : "text-band-low"}>
                  {status === "ok" ? "healthy" : "error"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
