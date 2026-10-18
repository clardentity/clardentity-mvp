"use client";

import type { PostHog } from "posthog-js";

/* Product analytics: which companions get used, and where people give up.
 *
 * Two rules decide everything about the shape of this file.
 *
 * The first is that this product's promise is that you can see what an
 * answer rests on. An app like that cannot ship a tracker that quietly
 * ships the questions people ask. So nothing here ever carries content:
 * no question text, no answer text, no file names, no email addresses,
 * no titles. Events carry a name and a handful of enumerated properties -
 * a mode, a count, a duration bucket - and are checked against that rule
 * where they are sent, not only where they are written (see `track`).
 *
 * The second is that it must be switchable off and invisible when it is.
 * With no key configured every function here is a no-op that costs one
 * comparison, the SDK is never downloaded, and no cookie is written -
 * which is also what makes the build safe to run in CI and in a local dev
 * loop without polluting the numbers.
 */

import { consentGranted } from "@/lib/consent";

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
/** EU by default: the app has users in India and the EU, and the EU host
 *  keeps the data under one regime rather than two. Overridable for a
 *  self-hosted instance. */
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/** Every event this app sends, in one place.
 *
 *  A closed list rather than free-form strings: an analytics property that
 *  only appears in one component is a question nobody can answer six months
 *  later, and a typo'd event name is a funnel with a hole in it. */
export type AnalyticsEvent =
  // The journey
  | "app_opened"
  | "signed_in"
  | "chat_opened"
  | "question_asked"
  | "gist_shown"
  | "answer_shown"
  | "answer_failed"
  // What people reach for
  | "mode_picked"
  // Co-Creative, where the model is the user's choice.
  | "model_picked"
  // Asked once, the first time Learning mode is opened.
  | "learning_role_set"
  // What the app is drawn in
  | "accent_picked"
  | "theme_picked"
  | "mode_switched_automatically"
  | "mode_switch_reverted"
  | "quick_answer_tapped"
  | "attachment_added"
  | "voice_recorded"
  | "call_started"
  | "completion_accepted"
  // The landing page's try-it-here box
  | "guest_demo_opened"
  | "guest_demo_asked"
  | "guest_demo_limit"
  | "guest_demo_signup_clicked"
  | "guest_demo_new_chat"
  | "guest_demo_mode_picked"
  // Which control a guest reached for that needs an account. The most
  // useful number the demo produces: it says what people came to the
  // product wanting, rather than what they settled for typing.
  | "guest_demo_gated"
  // How often the demo moves a question to a better companion, which is the
  // number that says whether smart switching is worth what it costs there.
  | "guest_demo_mode_switched"
  // Where they stop
  | "gate_shown"
  | "gate_answered"
  | "gate_skipped"
  | "locked_mode_tapped"
  // The Clar tiers, opened from Upgrade in the account menu.
  | "plans_opened"
  | "preview_opened"
  | "stream_dropped"
  // Housekeeping
  | "chat_renamed"
  | "chat_pinned"
  | "chat_moved"
  | "chat_deleted"
  | "tour_started"
  | "tour_finished"
  | "feedback_given"
  | "answer_regenerated"
  | "counterfactual_flipped"
  | "answer_listened"
  | "conversation_exported"
  | "document_uploaded"
  | "consent_choice";

/** Property values are deliberately narrow. A string here is a mode name, a
 *  gate kind, a file extension - never anything a user typed. */
export type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;

/** Configured *and* permitted. Both are required before anything is sent or
 *  even downloaded: a key without consent is a tracker nobody agreed to. */
function on(): boolean {
  return Boolean(KEY) && consentGranted();
}

export function analyticsEnabled(): boolean {
  return on();
}

/** Loaded on demand, after the first event rather than at boot: the SDK is
 *  ~60KB and nothing on the first paint depends on it. */
async function getClient(): Promise<PostHog | null> {
  if (!on() || !KEY) return null;
  if (client) return client;
  if (loading) return loading;
  loading = import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        // Off, all of it. Autocapture records clicks and the text of what
        // was clicked; session recording records the screen - which here is
        // someone's divorce question. Neither is worth the trade.
        autocapture: false,
        disable_session_recording: true,
        capture_pageview: false,
        capture_pageleave: false,
        // A person row only for someone who signed in, keyed by their user
        // id. Anonymous visitors are counted, not profiled.
        person_profiles: "identified_only",
        // Pageviews are sent by hand (see `trackPageView`) with the route
        // pattern, never the URL: a chat URL carries its conversation id.
        mask_all_text: true,
        mask_all_element_attributes: true,
        sanitize_properties: sanitize,
      });
      client = posthog;
      return posthog;
    })
    .catch(() => null);
  return loading;
}

/** Values that must never leave the browser, whatever a caller passes. */
const FORBIDDEN = /content|question|answer|text|title|email|name|filename|query|prompt/i;

export function track(event: AnalyticsEvent, props?: AnalyticsProps) {
  if (!on()) return;
  const safe: AnalyticsProps = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    // The guard is here, at the send, because this is the only place every
    // event passes through. A property whose name suggests it carries what
    // someone wrote is dropped rather than trusted - including one added in
    // a hurry by a future change that did not read the note at the top.
    if (FORBIDDEN.test(k)) continue;
    if (typeof v === "string" && v.length > 40) continue;
    safe[k] = v;
  }
  void getClient().then((c) => c?.capture(event, safe));
}

/** `/chat/6f2a…` -> `/chat/[id]`. A conversation id is a handle on somebody's
 *  private thread; it has no business in an analytics payload, and "which
 *  screens get used" is answered just as well by the shape of the route. */
export function routePattern(value: string): string {
  return value
    .replace(/\/chat\/[^/?#]+/g, "/chat/[id]")
    .replace(/\/workspace\/[^/?#]+/g, "/workspace/[id]");
}

/** The SDK attaches the current address to every event by itself - which put
 *  the conversation id straight back into the payload the rest of this file
 *  works to keep out. Every property that looks like a URL or a path is
 *  rewritten to its pattern on the way out, and the query string dropped:
 *  no reset token, no email in a link, ever. */
/** Modes whose use is itself sensitive: that someone opened Healthcare or
 *  Guidance can be health or mental-health information (Washington's My
 *  Health My Data Act counts even "seeking" health services). Analytics
 *  learns only that a sensitive companion was used - which one, and the
 *  counts per mode, stay in our own database (the admin overview). */
const SENSITIVE_MODES = new Set(["guidance", "healthcare"]);
const MODE_KEYS = /^(mode|from|to|suggested)$/;

export function sanitize(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (typeof value === "string" && MODE_KEYS.test(key) && SENSITIVE_MODES.has(value)) {
      out[key] = "sensitive";
      continue;
    }
    if (typeof value === "string" && /url|pathname|referrer|host|origin/i.test(key)) {
      const [withoutQuery] = value.split(/[?#]/);
      out[key] = routePattern(withoutQuery);
      continue;
    }
    out[key] = value;
  }
  return out;
}

/** The route pattern, not the address: `/chat/[id]`, never the id. */
export function trackPageView(pattern: string) {
  if (!on()) return;
  void getClient().then((c) => c?.capture("$pageview", { pattern }));
}

/** Called once a session is known. The id is the account's UUID - the email
 *  is not sent, here or anywhere else. */
export function identify(userId: string) {
  if (!on()) return;
  void getClient().then((c) => c?.identify(userId));
}

/** Signing out, or withdrawing consent. Not gated on `on()`: when consent is
 *  withdrawn this is exactly the call that has to still go through, to drop
 *  the identity and the stored distinct id rather than leave them behind. */
export function resetIdentity() {
  if (!KEY || !client) return;
  client.reset();
}

/** Durations as buckets rather than milliseconds: the question is "did that
 *  feel instant, quick, or slow", and a bucket answers it without turning
 *  every answer into a distinguishable fingerprint. */
export function durationBucket(ms: number): string {
  if (ms < 2000) return "0-2s";
  if (ms < 5000) return "2-5s";
  if (ms < 10000) return "5-10s";
  if (ms < 20000) return "10-20s";
  if (ms < 45000) return "20-45s";
  return "45s+";
}
