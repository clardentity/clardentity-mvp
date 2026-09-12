"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type TourStep = {
  id: string;
  /** Matches a `data-tour="<target>"` attribute somewhere in the DOM. */
  target: string;
  title: string;
  body: string;
  /** Set on a step whose "next" is a real page navigation. Two effects:
   *  the step's own advance button performs the highlighted action (clicks
   *  the target) instead of just incrementing, since the next target only
   *  exists on the next page; and `TourProvider` (mounted at the root, so it
   *  survives the navigation) advances when the path matches - whichever
   *  "New chat" control the user actually used, the page's or the sidebar's. */
  autoAdvanceWhenPathMatches?: RegExp;
};

export const TOUR_STEPS: TourStep[] = [
  {
    id: "new-chat",
    target: "new-chat",
    title: "Start here",
    body: 'Click "New chat" - or the tick below - to begin your first conversation.',
    autoAdvanceWhenPathMatches: /^\/chat\//,
  },
  {
    id: "mode-picker",
    target: "mode-picker",
    title: "Pick a cognitive mode",
    body: "Each mode changes how Clardentity thinks with you - pick whichever fits what you're trying to do.",
  },
  {
    id: "composer",
    target: "composer",
    title: "Ask your first question",
    body: "Type here, then hit Ask (or press Enter) for a checked, cited answer.",
  },
  {
    id: "library",
    target: "library",
    title: "Your documents and history",
    body: "Attachments ground every answer against your own files. Chats holds everything you've asked before.",
  },
];

type TourState = {
  status: "idle" | "active" | "completed" | "skipped";
  stepIndex: number;
};

const STORAGE_KEY = "clardentity-tour";
const IDLE_STATE: TourState = { status: "idle", stepIndex: 0 };

/* Same shape as AppShell's sidebar-collapse store and lib/theme's approach to
   persisted UI state: a plain module-level value read through
   useSyncExternalStore rather than useState + an effect, so a change is
   observed the instant it happens (no separate "detect a flag on mount"
   step, which would run once, too early, and never again - this component
   tree is mounted once at the root and survives every client-side
   navigation a new user makes). Unlike that store, this one *is* rendered
   into the very first server-rendered HTML (the overlay lives in the root
   layout, unconditionally), so getSnapshot must never run during SSR -
   hence the explicit getServerSnapshot below, matching
   useReducedMotion.ts's reasoning for the same hazard. */
let tourSnapshot: TourState | null = null;
const tourListeners = new Set<() => void>();

function subscribeTour(onChange: () => void) {
  tourListeners.add(onChange);
  return () => {
    tourListeners.delete(onChange);
  };
}

function readStoredState(): TourState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return IDLE_STATE;
    const parsed = JSON.parse(raw) as Partial<TourState>;
    if (
      (parsed.status === "idle" ||
        parsed.status === "active" ||
        parsed.status === "completed" ||
        parsed.status === "skipped") &&
      typeof parsed.stepIndex === "number"
    ) {
      return { status: parsed.status, stepIndex: parsed.stepIndex };
    }
  } catch {
    // Corrupt or blocked storage - treat as a user who's never started.
  }
  return IDLE_STATE;
}

function getTourSnapshot(): TourState {
  if (tourSnapshot === null) {
    tourSnapshot = readStoredState();
  }
  return tourSnapshot;
}

function getServerTourSnapshot(): TourState {
  return IDLE_STATE;
}

function setTourState(next: TourState) {
  tourSnapshot = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Best-effort only - a tour that can't survive a refresh is still a
    // working tour, just not a resumable one.
  }
  tourListeners.forEach((fn) => fn());
}

/** Begin (or begin again) from step 1. Called when the /welcome questions
 *  are finished or skipped - and only from there. Whether an account should
 *  see the tour is the server's decision (`onboarding_completed_at`, which
 *  RequireAuth gates /welcome on), so this deliberately ignores whatever
 *  this browser remembers: after an account-level reset, a browser that
 *  once skipped the tour must still show it. */
export function startTour() {
  setTourState({ status: "active", stepIndex: 0 });
}

export function advanceTour() {
  const current = getTourSnapshot();
  if (current.status !== "active") return;
  const nextIndex = current.stepIndex + 1;
  setTourState(
    nextIndex >= TOUR_STEPS.length
      ? { status: "completed", stepIndex: current.stepIndex }
      : { status: "active", stepIndex: nextIndex },
  );
}

/** Cancel at any time - "Skip tour" and Escape both call this. */
export function endTour() {
  const current = getTourSnapshot();
  if (current.status !== "active") return;
  setTourState({ status: "skipped", stepIndex: current.stepIndex });
}

export function useTour() {
  const state = useSyncExternalStore(subscribeTour, getTourSnapshot, getServerTourSnapshot);
  const active = state.status === "active";
  const step = active ? (TOUR_STEPS[state.stepIndex] ?? null) : null;
  return {
    active: active && step !== null,
    step,
    stepIndex: state.stepIndex,
    total: TOUR_STEPS.length,
    isLast: state.stepIndex === TOUR_STEPS.length - 1,
    advance: advanceTour,
    skip: endTour,
  };
}

/** Watches the route for the one step that's waiting on a real page
 *  navigation rather than a "Next" click, and advances the moment it
 *  happens. Renders nothing itself - TourOverlay (mounted alongside this in
 *  the root layout) is the visible piece. */
export function TourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { active, step } = useTour();

  useEffect(() => {
    if (!active || !step?.autoAdvanceWhenPathMatches) return;
    if (step.autoAdvanceWhenPathMatches.test(pathname)) {
      advanceTour();
    }
  }, [active, step, pathname]);

  return <>{children}</>;
}
