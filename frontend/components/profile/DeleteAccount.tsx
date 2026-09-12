"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage, useAuth } from "@/lib/auth";
import { Button, Card, CardHeader } from "@/components/ui/primitives";

/** Deletes the whole account - workspaces, chats, documents, profile. The
 *  same two-click confirm the rest of the app uses for destructive actions
 *  (an autofocused "Sure?" that cancels on blur), not a browser dialog. */
export function DeleteAccount() {
  const { logout } = useAuth();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/auth/me", { method: "DELETE" });
      logout();
      router.replace("/");
    } catch (err) {
      setError(authErrorMessage(err));
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Delete your account"
        description="Removes your account and everything in it - every workspace, chat, attachment and this profile. This can't be undone."
      />
      <div className="flex flex-wrap items-center gap-3">
        {confirming ? (
          <Button
            variant="danger"
            autoFocus
            onBlur={() => !busy && setConfirming(false)}
            onClick={handleDelete}
            disabled={busy}
          >
            {busy ? "Deleting…" : "Sure? Delete everything"}
          </Button>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete account
          </Button>
        )}
        {error && <span className="text-sm text-band-low">{error}</span>}
      </div>
    </Card>
  );
}
