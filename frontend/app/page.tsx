import { HealthStatus } from "@/components/system/HealthStatus";

export default function Home() {
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

        <HealthStatus />

        <p className="text-sm text-slate-500 dark:text-slate-500">
          Phase 1 scaffold — auth, chat, and the avatar companion arrive in
          later phases.
        </p>
      </main>
    </div>
  );
}
