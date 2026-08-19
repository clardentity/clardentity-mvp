"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { ImportHistory } from "@/components/profile/ImportHistory";
import { CompanionNames } from "@/components/profile/CompanionNames";
import { authErrorMessage } from "@/lib/auth";
import { AspectList, type Aspect } from "@/components/profile/AspectList";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";

type ProfileRole = {
  role_id: string;
  label: string;
  qualifiers: Record<string, string[]>;
  evidence: string;
};

type Profile = {
  personality_md: string | null;
  aspects: Aspect[];
  roles: ProfileRole[];
  user_edited: boolean;
  updated_at: string | null;
};

export function ProfileView() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState<"rebuild" | "clear" | null>(null);
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
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);


  async function handleAddAspect(label: string, value: string) {
    setError(null);
    try {
      setProfile(
        await apiFetch<Profile>("/profile/aspects", {
          method: "POST",
          body: { label, value },
        }),
      );
    } catch (err) {
      setError(authErrorMessage(err));
    }
  }

  async function handleRemoveAspect(id: string) {
    setError(null);
    try {
      setProfile(
        await apiFetch<Profile>(`/profile/aspects/${id}`, { method: "DELETE" }),
      );
    } catch (err) {
      setError(authErrorMessage(err));
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
      setProfile({
        personality_md: null,
        aspects: [],
        roles: [],
        user_edited: false,
        updated_at: null,
      });
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

  // A profile now exists as soon as there is anything in it, inferred or
  // written by hand. Gating on personality_md hid the add form from exactly
  // the people who had nothing yet and most wanted to write something.
  // Optional chaining rather than a direct read. A response missing either
  // array - an older backend, a partial payload, a proxy that dropped a field
  // - took the whole page down to a runtime error, which is a strictly worse
  // outcome than rendering the empty state and letting them add something.
  const aspects = profile?.aspects ?? [];
  const roles = profile?.roles ?? [];
  const hasProfile = aspects.length > 0 || roles.length > 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Your profile"
        description="Built from your own chats and documents, so the companion knows who it's talking to. Yours to correct or delete."
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

      {(
        <div className="space-y-5">
          <ImportHistory onImported={() => setReloadKey((k) => k + 1)} />

          <Card>
            <CardHeader
              title="Name your companion"
              description="Each mode can go by a name you choose. Named modes show that name in the mode switcher, and the companion answers to it. Leave one blank to keep its own label."
            />
            <CompanionNames />
          </Card>
          <Card>
            <CardHeader
              title="What it knows about you"
              description="Each line is a separate fact you can remove on its own. Anything you add yourself survives the next rebuild."
            />
            <AspectList
              aspects={aspects}
              busy={busy !== null}
              onAdd={handleAddAspect}
              onRemove={handleRemoveAspect}
            />
          </Card>

          <Card>
            <CardHeader
              title="Life roles"
              description="The positions you appear to occupy, and what suggested each one."
            />
            {roles.length > 0 ? (
              <ul className="divide-y divide-hairline">
                {roles.map((r) => (
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
