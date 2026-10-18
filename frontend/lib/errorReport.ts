import { routePattern, sanitize } from "@/lib/analytics";

/* Crash reports from the error screens' "Report" link.
 *
 * Sent through PostHog, the analytics the app already has, as one
 * `error_reported` event. Analytics normally waits for consent; tapping
 * "Send report" is that consent for this one event, and nothing else - the
 * SDK is loaded with in-memory persistence (no cookie, no stored id) if it
 * wasn't already running, and nothing is tracked after it.
 *
 * What goes: the reference shown to the person, which part of the app
 * failed, the error's type, the first frame of its stack, and the route
 * pattern (never the URL - a chat URL carries its conversation id). What
 * never goes: the error message, which can quote whatever was on screen. */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";

/** A short reference to quote to support: "7F3A-C21D". */
export function makeErrorRef(): string {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4)}`;
}

/** Sends the report; resolves to whether it actually left the browser. A
 *  deployment without an analytics key (local, the demo) has nowhere to send
 *  it, and the screen says so rather than claiming it was sent. */
export async function sendErrorReport(ref: string, where: string, error: Error): Promise<boolean> {
  if (!KEY) return false;
  try {
    const { default: posthog } = await import("posthog-js");
    if (!posthog.__loaded) {
      posthog.init(KEY, {
        api_host: HOST,
        persistence: "memory",
        autocapture: false,
        disable_session_recording: true,
        capture_pageview: false,
        capture_pageleave: false,
        person_profiles: "identified_only",
        // A crash report needs none of PostHog's remote machinery: no
        // feature flags, no surveys, no extra scripts fetched from its host.
        // One request out, and nothing left running afterwards.
        advanced_disable_flags: true,
        advanced_disable_feature_flags: true,
        disable_surveys: true,
        disable_external_dependency_loading: true,
        // The SDK adds the page address to every event by itself - on the
        // reset page that address carries the reset token. The same
        // clean-up analytics uses: route patterns, never query strings. Set
        // here too because whichever init runs first is the one PostHog
        // keeps for the rest of the page.
        sanitize_properties: sanitize,
      });
    }
    const frame = (error.stack ?? "").split("\n").find((l) => l.includes("/_next/") || l.includes("webpack")) ?? "";
    posthog.capture("error_reported", {
      ref,
      where,
      error_type: error.name || "Error",
      frame: frame.trim().slice(0, 160),
      route: routePattern(window.location.pathname),
    }, { send_instantly: true }); // now, not in the next batch - the tab may be about to close
    return true;
  } catch {
    return false;
  }
}
