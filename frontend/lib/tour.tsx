"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export type TourId = "workspace" | "chat";

export type TourStep = {
  id: string;
  /** Matches a `data-tour="<target>"` attribute somewhere in the DOM. */
  target: string;
  title: string;
  body: string;
  /** The target lives in the sidebar, which on a phone is a closed drawer.
   *  The overlay asks the shell to open it when this step can't find its
   *  target, rather than falling straight back to an anchorless callout. */
  sidebar?: boolean;
};

/* Two tours, one per screen a new user meets, each started the first time
 * that screen is opened (per browser) and never again - except that
 * finishing the welcome questions forgets both, which is how an
 * account-level reset re-shows them in a browser that already dismissed
 * them, and the header's "Show me around" button replays the current page's
 * on demand. Since sign-in lands straight in a chat, the chat tour is
 * usually the first one seen; the workspace tour waits for the first visit
 * to a workspace page. Steps here point only at things that exist on an
 * empty account: no step depends on a chat or an attachment already
 * existing. */
export const TOURS: Record<TourId, TourStep[]> = {
  workspace: [
    {
      id: "workspace-switcher",
      target: "workspace-switcher",
      title: "This is your workspace",
      body: "Chats, attachments and what Clardentity learns about you all live inside one. Switch between workspaces, or make another, here.",
      sidebar: true,
    },
    {
      id: "nav-attachments",
      target: "nav-attachments",
      title: "Attachments",
      body: "Upload PDFs and documents here. Every answer is checked against them and cites them by name, so you can see what it rests on.",
      sidebar: true,
    },
    {
      id: "nav-chats",
      target: "nav-chats",
      title: "Chats",
      body: "Search and browse every conversation you've had in this workspace.",
      sidebar: true,
    },
    {
      id: "nav-workspaces",
      target: "nav-workspaces",
      title: "Workspaces",
      body: "All of yours in one list. Keep separate projects in separate workspaces so their attachments and memory stay apart.",
      sidebar: true,
    },
    {
      id: "nav-profile",
      target: "nav-profile",
      title: "Your profile",
      body: "What Clardentity has learned about you - yours to read, correct or delete - plus companion names and your account.",
      sidebar: true,
    },
    {
      id: "nav-upgrade",
      target: "nav-upgrade",
      title: "Plans",
      body: "What Pro, Max and Ultra will add, and a place to be told when they open.",
      sidebar: true,
    },
    {
      id: "theme-toggle",
      target: "theme-toggle",
      title: "Light or dark",
      body: "Whichever you prefer - it's remembered on this device.",
    },
    {
      id: "chat-list",
      target: "chat-list",
      title: "Your conversations",
      body: "Every chat in this workspace collects here, newest first. The bin icon on a row deletes it.",
    },
    {
      id: "new-chat",
      target: "new-chat",
      title: "Start a chat",
      body: "A new chat in this workspace. The question mark in the top bar replays this tour any time.",
    },
  ],
  chat: [
    {
      id: "companion",
      target: "companion",
      title: "Meet your companion",
      body: "Its expression tracks how solid each answer is - confident, cautious or concerned - so you can read the mood before the detail.",
    },
    {
      id: "mode-picker",
      target: "mode-picker",
      title: "Choose how it thinks",
      body: "You open in Finder - it finds the answer and checks every claim against a source. Switch here for a different kind: Decision-making weighs options, Thought coach shows its reasoning, Learning teaches.",
    },
    {
      id: "switching-toggle",
      target: "switching-toggle",
      title: "Smart switching",
      body: "On Smart, a question that fits another mode better is answered there automatically, with one tap to have it answered in your mode instead. Manual keeps you where you are.",
    },
    {
      id: "composer-input",
      target: "composer-input",
      title: "Ask here",
      body: "Type your question. Enter sends it, Shift+Enter starts a new line. Spelling is checked as you type.",
    },
    {
      id: "model-picker",
      target: "model-picker",
      title: "Model",
      body: "Leave it on Auto and Clardentity picks the right one for the job, or choose yourself.",
    },
    {
      id: "voice",
      target: "voice",
      title: "Speak instead",
      body: "Record a voice message and it's transcribed into the box - and we'll tell you if we didn't catch it, rather than guessing.",
    },
    {
      id: "live-call",
      target: "live-call",
      title: "Or talk it through",
      body: "A live voice conversation, saved into this chat when you hang up.",
    },
    {
      id: "attach-image",
      target: "attach-image",
      title: "Attach a file",
      body: "Add a picture, a PDF, a spreadsheet, a deck or a document to ask about it. Files are read, cited, and kept in the workspace for later questions.",
    },
    {
      id: "autocomplete",
      target: "composer-input",
      title: "It finishes your sentence",
      body: "Spelling is corrected as you type, and after a pause a grey suggestion may appear ahead of your words. Press Shift to take it, or just keep typing.",
    },
    {
      id: "ask-button",
      target: "ask-button",
      title: "Ask",
      body: "While it thinks you'll see the rabbit, not a wall of text; Stop or Esc cancels. If an answer is going to take a while, a Quick answer button appears - tap it for an instant, unchecked one. Every answer opens with its gist, with the reasoning and sources folded beneath.",
    },
  ],
};

type TourStatus = "completed" | "skipped";

type TourState = {
  active: TourId | null;
  stepIndex: number;
  done: Partial<Record<TourId, TourStatus>>;
};

const STORAGE_KEY = "clardentity-tour";
const IDLE_STATE: TourState = { active: null, stepIndex: 0, done: {} };

/* Same shape as AppShell's sidebar-collapse store and lib/theme's approach to
   persisted UI state: a plain module-level value read through
   useSyncExternalStore, so a change is observed the instant it happens. This
   store *is* rendered into the first server-rendered HTML (the overlay lives
   in the root layout), so getSnapshot must never run during SSR - hence the
   explicit getServerSnapshot, matching useReducedMotion.ts. */
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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // The previous single-tour format ({status, stepIndex}) was a four-step
    // tour that covered a fraction of what these two do, so a browser that
    // finished it starts fresh rather than being credited with either.
    if (typeof parsed.status === "string") return IDLE_STATE;
    const active = parsed.active;
    const done = (parsed.done && typeof parsed.done === "object" ? parsed.done : {}) as TourState["done"];
    if ((active === null || active === "workspace" || active === "chat") && typeof parsed.stepIndex === "number") {
      return { active: active as TourId | null, stepIndex: parsed.stepIndex, done };
    }
  } catch {
    // Corrupt or blocked storage - treat as a browser that's seen nothing.
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

/** Begin a tour from step 1. `force` restarts it even if this browser has
 *  already finished or skipped it - used by the welcome page, because whether
 *  an account should see the tours again is the server's decision, not this
 *  browser's memory. Without `force`, a finished tour stays finished and a
 *  tour already running is left alone. */
export function startTour(id: TourId, options: { force?: boolean } = {}) {
  const current = getTourSnapshot();
  if (!options.force && (current.done[id] || current.active === id)) return;
  const done = { ...current.done };
  delete done[id];
  setTourState({ active: id, stepIndex: 0, done });
}

export function advanceTour() {
  const current = getTourSnapshot();
  if (!current.active) return;
  const nextIndex = current.stepIndex + 1;
  if (nextIndex >= TOURS[current.active].length) {
    setTourState({ active: null, stepIndex: 0, done: { ...current.done, [current.active]: "completed" } });
  } else {
    setTourState({ ...current, stepIndex: nextIndex });
  }
}

/** Forget both tours, so each starts again the next time its screen is
 *  opened. The welcome page calls this: whether an account should see the
 *  tours again is the server's decision (it just sent them through the
 *  welcome questions), not this browser's memory. Nothing starts here -
 *  TourProvider starts whichever tour matches the page they land on. */
export function resetTours() {
  setTourState({ active: null, stepIndex: 0, done: {} });
}

/** Cancel at any time - "Skip tour" and Escape both call this. */
export function endTour() {
  const current = getTourSnapshot();
  if (!current.active) return;
  setTourState({ active: null, stepIndex: 0, done: { ...current.done, [current.active]: "skipped" } });
}

export function useTour() {
  const state = useSyncExternalStore(subscribeTour, getTourSnapshot, getServerTourSnapshot);
  const steps = state.active ? TOURS[state.active] : null;
  const step = steps ? (steps[state.stepIndex] ?? null) : null;
  return {
    tour: step ? state.active : null,
    active: step !== null,
    step,
    stepIndex: state.stepIndex,
    total: steps?.length ?? 0,
    isLast: steps ? state.stepIndex === steps.length - 1 : false,
    advance: advanceTour,
    skip: endTour,
  };
}

const WORKSPACE_PAGE = /^\/workspace\/[^/]+$/;
const CHAT_PAGE = /^\/chat\//;

/** Starts each tour the first time its screen is opened, and hands over
 *  from the workspace tour to the chat tour when the user moves on (a
 *  half-finished workspace tour is counted as done - they've clearly found
 *  the thing it was leading to). Renders nothing itself; TourOverlay,
 *  mounted alongside this in the root layout, is the visible piece. */
export function TourProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const state = useSyncExternalStore(subscribeTour, getTourSnapshot, getServerTourSnapshot);

  useEffect(() => {
    if (CHAT_PAGE.test(pathname)) {
      if (state.active === "workspace") {
        setTourState({ active: null, stepIndex: 0, done: { ...state.done, workspace: "completed" } });
      }
      if (state.active === null && !state.done.chat) startTour("chat");
    } else if (WORKSPACE_PAGE.test(pathname)) {
      if (state.active === null && !state.done.workspace) startTour("workspace");
    }
  }, [pathname, state]);

  return <>{children}</>;
}
