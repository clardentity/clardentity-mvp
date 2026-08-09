"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import {
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui/primitives";

type ScoringWeights = {
  claim_score_weight: number;
  citation_coverage_weight: number;
  relevance_weight: number;
  distortion_penalty: number;
  likely_fact_cutoff: number;
  plausible_cutoff: number;
};

type AvatarGestureMap = {
  knowing: string;
  thinking: string;
  decision: string;
  learning: string;
};

type FeatureFlags = {
  tts_enabled: boolean;
  image_input_enabled: boolean;
  bias_screening_enabled: boolean;
};

const FLAG_LABELS: Record<keyof FeatureFlags, { label: string; hint: string }> = {
  tts_enabled: {
    label: "Text to speech",
    hint: "Adds a Listen control to assistant messages.",
  },
  image_input_enabled: {
    label: "Image input",
    hint: "Allows images to be attached to a message as vision context.",
  },
  bias_screening_enabled: {
    label: "Decision-domain bias screening",
    hint: "Classifies the decision to scope bias screening and surface a bias watch-list. Screening still runs when off, just unscoped.",
  },
};

type Settings = {
  openai_model: string | null;
  openai_temperature: number | null;
  retrieval_top_k: number;
  scoring_weights: ScoringWeights;
  avatar_gesture_map: AvatarGestureMap;
  feature_flags: FeatureFlags;
};

const GESTURE_OPTIONS = ["presenting", "chin_stroke", "weighing_scales", "open_hand_explaining", "none"];
const MODES: (keyof AvatarGestureMap)[] = ["knowing", "thinking", "decision", "learning"];

export function AdminSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ settings: Settings }>("/admin/settings")
      .then((data) => {
        if (!cancelled) setSettings(data.settings);
      })
      .catch((err) => {
        if (!cancelled) setError(authErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  function updateScoringWeight<K extends keyof ScoringWeights>(key: K, value: number) {
    setSettings((prev) =>
      prev ? { ...prev, scoring_weights: { ...prev.scoring_weights, [key]: value } } : prev,
    );
  }

  function updateGesture(mode: keyof AvatarGestureMap, gesture: string) {
    setSettings((prev) =>
      prev ? { ...prev, avatar_gesture_map: { ...prev.avatar_gesture_map, [mode]: gesture } } : prev,
    );
  }

  function updateFlag(key: keyof FeatureFlags, value: boolean) {
    setSettings((prev) => (prev ? { ...prev, feature_flags: { ...prev.feature_flags, [key]: value } } : prev));
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setSavedAt(null);
    try {
      // FR14: each key is its own admin_settings row server-side, so persist
      // them independently rather than requiring one combined shape.
      for (const [key, value] of Object.entries(settings)) {
        await apiFetch("/admin/settings", { method: "PUT", body: { key, value } });
      }
      setSavedAt(Date.now());
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (error && !settings) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
          {error}
        </div>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner className="text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Admin settings"
        description="Model parameters, scoring weights, avatar gestures, and feature flags. Changes take effect on the next request."
        actions={
          <div className="flex items-center gap-3">
            {savedAt && <span className="text-sm text-band-high">Saved</span>}
            <Button variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        }
      />

      <div className="space-y-5">
        <Card>
          <CardHeader
            title="Model"
            description="Overrides applied to every generation request."
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="OpenAI model" hint="Blank uses the server default.">
              <Input
                value={settings.openai_model ?? ""}
                onChange={(e) => update("openai_model", e.target.value || null)}
                placeholder="e.g. gpt-5"
              />
            </Field>
            <Field label="Temperature" hint="Blank omits the parameter entirely.">
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={settings.openai_temperature ?? ""}
                onChange={(e) =>
                  update(
                    "openai_temperature",
                    e.target.value === "" ? null : Number(e.target.value),
                  )
                }
              />
            </Field>
            <Field label="Retrieval top-k" hint="Chunks retrieved per query.">
              <Input
                type="number"
                min="1"
                max="50"
                value={settings.retrieval_top_k}
                onChange={(e) => update("retrieval_top_k", Number(e.target.value))}
              />
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Scoring weights"
            description="How per-claim scores roll up into a message confidence band (SRS §9.3)."
          />
          <div className="grid gap-4 sm:grid-cols-3">
            {(Object.keys(settings.scoring_weights) as (keyof ScoringWeights)[]).map(
              (key) => (
                <Field key={key} label={key.replace(/_/g, " ")}>
                  <Input
                    type="number"
                    step="0.01"
                    value={settings.scoring_weights[key]}
                    onChange={(e) => updateScoringWeight(key, Number(e.target.value))}
                  />
                </Field>
              ),
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Avatar gestures"
            description="Which gesture the companion performs for each cognitive mode."
          />
          <div className="divide-y divide-hairline">
            {MODES.map((mode) => (
              <label
                key={mode}
                className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
              >
                <span className="text-sm capitalize text-ink">{mode}</span>
                <select
                  value={settings.avatar_gesture_map[mode]}
                  onChange={(e) => updateGesture(mode, e.target.value)}
                  className="h-9 rounded-lg border border-hairline-strong bg-surface px-2 text-sm text-ink transition-colors hover:border-brand-border focus:border-brand"
                >
                  {GESTURE_OPTIONS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader title="Feature flags" />
          <div className="divide-y divide-hairline">
            {(Object.keys(FLAG_LABELS) as (keyof FeatureFlags)[]).map((key) => (
              <label
                key={key}
                className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {FLAG_LABELS[key].label}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {FLAG_LABELS[key].hint}
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={settings.feature_flags?.[key] ?? true}
                  onChange={(e) => updateFlag(key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                />
              </label>
            ))}
          </div>
        </Card>

        {error && (
          <div className="rounded-lg border border-band-low-border bg-band-low-bg px-3 py-2 text-sm text-band-low">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
