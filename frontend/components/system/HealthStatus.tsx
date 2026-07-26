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
    <div className="rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 text-sm font-medium text-slate-500 dark:text-slate-400">
        Backend connectivity
      </h2>

      {state.kind === "loading" && (
        <p className="text-sm text-slate-500">Checking…</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Could not reach the backend at {BACKEND_ROOT_URL} ({state.message})
        </p>
      )}

      {state.kind === "loaded" && (
        <ul className="space-y-1.5">
          {Object.entries(state.data.dependencies).map(([name, status]) => (
            <li key={name} className="flex items-center justify-between text-sm">
              <span className="capitalize text-slate-700 dark:text-slate-300">
                {name}
              </span>
              <span
                className={
                  status === "ok"
                    ? "font-medium text-emerald-600 dark:text-emerald-400"
                    : "font-medium text-red-600 dark:text-red-400"
                }
              >
                {status === "ok" ? "healthy" : "error"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
