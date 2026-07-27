"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";

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
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-1 items-center justify-center px-6 py-24">
        <p className="text-sm text-slate-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-lg space-y-8 px-6 py-16">
      <div>
        <h1 className="text-2xl font-semibold">Admin settings</h1>
        <p className="text-sm text-slate-500">
          Model parameters, scoring weights, avatar gestures, and feature flags — effective on the next request.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">Model</h2>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">
            OpenAI model override (blank = use server default)
          </span>
          <input
            value={settings.openai_model ?? ""}
            onChange={(e) => update("openai_model", e.target.value || null)}
            placeholder="e.g. gpt-5"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">
            Temperature override (blank = don&apos;t send)
          </span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="2"
            value={settings.openai_temperature ?? ""}
            onChange={(e) =>
              update("openai_temperature", e.target.value === "" ? null : Number(e.target.value))
            }
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">Retrieval top-k</span>
          <input
            type="number"
            min="1"
            max="50"
            value={settings.retrieval_top_k}
            onChange={(e) => update("retrieval_top_k", Number(e.target.value))}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">Scoring weights</h2>
        {(Object.keys(settings.scoring_weights) as (keyof ScoringWeights)[]).map((key) => (
          <label key={key} className="block text-sm">
            <span className="mb-1 block text-slate-600 dark:text-slate-400">{key.replace(/_/g, " ")}</span>
            <input
              type="number"
              step="0.01"
              value={settings.scoring_weights[key]}
              onChange={(e) => updateScoringWeight(key, Number(e.target.value))}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </label>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">Avatar gesture mapping</h2>
        {MODES.map((mode) => (
          <label key={mode} className="flex items-center justify-between text-sm">
            <span className="text-slate-600 dark:text-slate-400 capitalize">{mode}</span>
            <select
              value={settings.avatar_gesture_map[mode]}
              onChange={(e) => updateGesture(mode, e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            >
              {GESTURE_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-slate-500">Feature flags</h2>
        <label className="flex items-center justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-400">TTS enabled</span>
          <input
            type="checkbox"
            checked={settings.feature_flags.tts_enabled}
            onChange={(e) => updateFlag("tts_enabled", e.target.checked)}
            className="h-4 w-4"
          />
        </label>
        <label className="flex items-center justify-between text-sm">
          <span className="text-slate-600 dark:text-slate-400">Image input enabled</span>
          <input
            type="checkbox"
            checked={settings.feature_flags.image_input_enabled}
            onChange={(e) => updateFlag("image_input_enabled", e.target.checked)}
            className="h-4 w-4"
          />
        </label>
      </section>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {savedAt && <p className="text-sm text-green-600 dark:text-green-400">Saved.</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}
