"use client";

import { useServerWait } from "@/lib/serverWait";

/** Says why nothing is happening while the backend wakes from a quiet spell
 *  (see lib/serverWait) - on the login screen, behind the first spinner, on
 *  any list - instead of a spinner that might as well be a hang. Phone
 *  layout only; it goes once the server answers. */
export function ServerWakingNotice() {
  const wait = useServerWait();
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(var(--topbar-height)+8px)] z-[60] flex justify-center px-4 lg:hidden"
    >
      {wait !== "none" && (
        <p
          data-testid="server-waking"
          className="flex max-w-sm items-center gap-2.5 rounded-2xl border border-hairline-strong bg-surface-raised px-4 py-2.5 text-sm text-ink shadow-sm animate-[fade-in_0.3s_ease]"
        >
          <span aria-hidden="true" className="size-2 shrink-0 animate-pulse rounded-full bg-brand" />
          {wait === "waking"
            ? "Waking the server up - this can take up to a minute after a quiet spell."
            : "Still waking up - nearly there. Nothing you've done is lost."}
        </p>
      )}
    </div>
  );
}
