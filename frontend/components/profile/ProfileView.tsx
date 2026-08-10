"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
  Textarea,
} from "@/components/ui/primitives";

type ProfileRole = {
  role_id: string;
  label: string;
  qualifiers: Record<string, string[]>;
  evidence: string;
};

type Profile = {
  personality_md: string | null;
  roles: ProfileRole[];
  user_edited: boolean;
  updated_at: string | null;
};

export function ProfileView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"save" | "rebuild" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // `reloadKey` drives the fetch instead of calling a loader directly, so the
  // effect body never calls setState (which cascades renders); refreshing is
  // just a key bump.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Profile>("/profile")
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        setDraft(p.personality_md ?? "");
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function handleSave() {
    setBusy("save");
    setError(null);
    try {
      const p = await apiFetch<Profile>("/profile", {
        method: "PUT",
        body: { personality_md: draft },
      });
      setProfile(p);
      setEditing(false);
      setNotice("Saved. This won't be overwritten automatically any more.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleRebuild() {
    setBusy("rebuild");
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/profile/rebuild", { method: "POST" });
      setNotice(
        "Rebuilding from your history. This runs in the background - use Refresh in a moment to see it.",
      );
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function handleClear() {
    setBusy("clear");
    setError(null);
    try {
      await apiFetch("/profile", { method: "DELETE" });
      setProfile({ personality_md: null, roles: [], user_edited: false, updated_at: null });
      setDraft("");
      setEditing(false);
      setNotice("Profile deleted. It will start building again as you use the app.");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!profile && !error) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  const hasProfile = !!profile?.personality_md;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Your profile"
        description="Built from your own conversations and documents, so the companion knows who it's talking to. Yours to correct or delete."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setReloadKey((k) => k + 1)} disabled={busy !== null}>
              Refresh
            </Button>
            <Button onClick={handleRebuild} disabled={busy !== null}>
              {busy === "rebuild" ? "Rebuilding…" : "Rebuild"}
            </Button>
            {hasProfile && (
              <Button variant="danger" onClick={handleClear} disabled={busy !== null}>
                {busy === "clear" ? "Deleting…" : "Delete"}
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-sm text-ink-secondary">
          {notice}
        </div>
      )}

      {!hasProfile ? (
        <EmptyState
          title="Nothing here yet"
          description="Ask a few questions and this fills in on its own. Nothing is inferred from an onboarding form - it comes from how you actually use the app."
        />
      ) : (
        <div className="space-y-5">
          <Card>
            <CardHeader
              title="personality.md"
              description={
                profile?.user_edited
                  ? "You've edited this, so it won't be regenerated automatically."
                  : "Generated from your history and kept up to date as you use the app."
              }
              action={
                !editing && (
                  <Button size="sm" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )
              }
            />

            {editing ? (
              <div className="space-y-3">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={16}
                  className="font-mono text-xs"
                  aria-label="Profile markdown"
                />
                <div className="flex items-center gap-2">
                  <Button variant="primary" onClick={handleSave} disabled={busy !== null}>
                    {busy === "save" ? "Saving…" : "Save"}
                  </Button>
                  <Button
                    onClick={() => {
                      setDraft(profile?.personality_md ?? "");
                      setEditing(false);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-ink-secondary">
                {profile?.personality_md}
              </pre>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Life roles"
              description="The positions you appear to occupy, and what suggested each one."
            />
            {profile && profile.roles.length > 0 ? (
              <ul className="divide-y divide-hairline">
                {profile.roles.map((r) => (
                  <li key={r.role_id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-ink">{r.label}</span>
                      {Object.values(r.qualifiers)
                        .flat()
                        .map((v) => (
                          <Badge key={v} tone="brand">
                            {v}
                          </Badge>
                        ))}
                    </div>
                    {r.evidence && (
                      <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                        {r.evidence}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-muted">
                No roles inferred yet - nothing in your history clearly indicated one.
              </p>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
