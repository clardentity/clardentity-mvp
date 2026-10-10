"use client";

import Link from "next/link";
import { ErrorBoundary } from "@/components/system/ErrorBoundaries";
import { AppNotices } from "@/components/system/AppNotices";
import { OfflineNotice } from "@/components/system/OfflineNotice";
import { usePathname, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { ChatRowMenu } from "@/components/chat/ChatRowMenu";
import { rememberWorkspace } from "@/lib/lastWorkspace";
import { startTour, type TourId } from "@/lib/tour";
import { rectScale } from "@/lib/uiScale";
import { MaskIcon } from "@/components/ui/MaskIcon";
import { AccountMenu } from "@/components/system/AccountMenu";
import { cx } from "@/components/ui/primitives";
import { useScrollEdges } from "@/lib/useScrollEdges";

/* Sidebar collapse lives in a tiny external store read through
   useSyncExternalStore rather than useState + an effect. Reading localStorage
   in an effect and calling setState is a cascading render (and the lint rule
   says so); reading it in a lazy initialiser makes the server and client
   disagree about a className. This gives React a server snapshot to hydrate
   against and the real value immediately after. */
const SIDEBAR_STORAGE_KEY = "clardentity-sidebar-collapsed";

let sidebarSnapshot: boolean | null = null;
const sidebarListeners = new Set<() => void>();

function subscribeSidebar(onChange: () => void) {
  sidebarListeners.add(onChange);
  return () => {
    sidebarListeners.delete(onChange);
  };
}

function getSidebarSnapshot(): boolean {
  // Cached because getSnapshot must return a referentially stable value; a
  // fresh read every call is fine for a boolean, but this also avoids hitting
  // localStorage on every render.
  if (sidebarSnapshot === null) {
    sidebarSnapshot = localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
  }
  return sidebarSnapshot;
}

function setSidebarCollapsed(next: boolean) {
  sidebarSnapshot = next;
  localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
  sidebarListeners.forEach((fn) => fn());
}

type Workspace = { id: string; name: string; role: string };

/* --------------------------------------------------------------- icons -- */
/* Inline so the shell stays dependency-free; 16px on a 24px grid. */

function Icon({ path, className }: { path: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cx("h-4 w-4 shrink-0", className)}
    >
      {path}
    </svg>
  );
}

const icons = {
  rooms: <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></>,
  chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
  docs: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.44.62.79.75H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  profile: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  panelLeft: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  trash: <><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>,
  admin: <><path d="M3 13h4v7H3zM10 8h4v12h-4zM17 4h4v16h-4z" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
};

/* ------------------------------------------------------------- sidebar -- */

type RecentConversation = {
  id: string;
  title: string | null;
  created_at: string;
  pinned?: boolean;
};

const RECENTS_SHOWN = 12;

/** Recent conversations in the active room.
 *
 *  Its own component so the sidebar doesn't re-render on every keystroke of a
 *  fetch it doesn't own, and so "no room selected" is one early return rather
 *  than a condition threaded through the nav. */
function RecentConversations({
  workspaceId,
  workspaces,
  activeId,
  refreshKey,
  onNavigate,
}: {
  workspaceId: string | null;
  /** For the row menu's "Move to workspace". */
  workspaces: Workspace[];
  activeId: string | null;
  refreshKey: number;
  onNavigate?: () => void;
}) {
  const [items, setItems] = useState<RecentConversation[]>([]);
  // Total in the workspace, so the list can say when it is showing only the
  // newest few - chats past the cut-off had simply "vanished" as far as
  // anyone could tell from here.
  const [total, setTotal] = useState(0);
  // Bumped by the row menu after a rename, a pin or a move, so the list
  // re-reads (a pin changes the order, a move takes the row out of it).
  const [localKey, setLocalKey] = useState(0);
  const reload = useCallback(() => setLocalKey((n) => n + 1), []);
  const router = useRouter();

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    apiFetch<RecentConversation[]>(`/chat/conversations?workspace_id=${workspaceId}`)
      .then((rows) => {
        if (cancelled) return;
        setTotal(rows.length);
        setItems(rows.slice(0, RECENTS_SHOWN));
      })
      .catch(() => {
        // A sidebar that can't list history is not worth an error state; the
        // room page below shows the same list with one.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey, activeId, localKey]);

  /** After the row menu has deleted it: drop it from the list, and move off
   *  it if it is what you were reading - the next render would fetch a 404. */
  function remove(id: string) {
    setItems((prev) => prev.filter((c) => c.id !== id));
    setTotal((n) => Math.max(0, n - 1));
    if (id === activeId) router.push(workspaceId ? `/workspace/${workspaceId}` : "/workspace");
  }

  const fadeEdges = useScrollEdges("y");

  if (!workspaceId || items.length === 0) return <div className="flex-1" />;

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <p className="px-4 pb-1 text-sm font-medium uppercase text-[color:var(--text-nav-muted)]">
        Recents
      </p>
      <ul ref={fadeEdges} className="scroll-slim scroll-fade-y min-h-0 flex-1 overflow-y-auto">
        {items.map((c, i) => (
          <li key={c.id} className="phone-rise group/recent flex items-center" style={{ "--i": i } as React.CSSProperties}>
            {/* 32px row, 9px radius, a 12px ring and a 20px title - the
                design's shape. The ring is what gives the list its rhythm
                against the 48px rows above it. */}
            <Link
              href={`/chat/${c.id}`}
              onClick={onNavigate}
              aria-current={c.id === activeId ? "page" : undefined}
              className={cx(
                // 36px on a touch screen (measured on the glass, hence the
                // zoom divide): the drawn 32px row is 27px under the 85% zoom,
                // half a fingertip, in a list where a miss opens the wrong chat.
                "flex h-8 min-w-0 flex-1 items-center gap-5 truncate rounded-[9px] pl-4 pr-1.5 text-sm transition-colors phone-touch:h-[calc(36px/var(--ui-zoom))]",
                c.id === activeId
                  ? "bg-[var(--surface-hover)] font-medium text-ink"
                  : "text-[color:var(--text-nav)] hover:bg-surface-hover hover:text-ink",
              )}
            >
              <MaskIcon src="/ui/recent-dot.svg" size={12} />
              <span className="truncate">{c.title || "Untitled chat"}</span>
            </Link>
            {/* In the row rather than over it, so the title truncates earlier
                instead of the control printing across the end of it. */}
            <ChatRowMenu
              conversationId={c.id}
              title={c.title}
              pinned={Boolean(c.pinned)}
              workspaceId={workspaceId}
              workspaces={workspaces}
              onChanged={reload}
              onDeleted={() => remove(c.id)}
              className="mr-1"
            />
          </li>
        ))}
      </ul>
      {total > items.length && (
        <Link
          href={`/workspace/${workspaceId}/search`}
          onClick={onNavigate}
          className="mt-1 rounded-lg px-2.5 py-1.5 text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          See all {total} chats
        </Link>
      )}
    </div>
  );
}

/* The design's navigation row: 263 x 48, 9px radius, a 24px icon and a 20px
 * label in the warm grey it reserves for chrome. `iconSrc` takes one of the
 * design's own SVGs; `icon` is the inline-path fallback for rows the design
 * does not draw (Admin). */
function NavItem({
  href,
  icon,
  iconSrc,
  children,
  active,
  onNavigate,
  tourId,
}: {
  href: string;
  icon?: ReactNode;
  iconSrc?: string;
  children: ReactNode;
  active: boolean;
  onNavigate?: () => void;
  /** Coachmark target name - see lib/tour.tsx. */
  tourId?: string;
}) {
  return (
    <Link
      href={href}
      data-tour={tourId}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cx(
        "tap-target flex h-12 items-center gap-3 rounded-[9px] px-4 text-sm transition-colors",
        active
          ? "bg-[var(--surface-hover)] font-medium text-ink"
          : "text-[color:var(--text-nav)] hover:bg-surface-hover hover:text-ink",
      )}
    >
      {iconSrc ? (
        <MaskIcon src={iconSrc} size={24} />
      ) : (
        <Icon path={icon} className="h-6 w-6 shrink-0" />
      )}
      <span className="truncate">{children}</span>
    </Link>
  );
}

function WorkspaceSwitcher({
  workspaces,
  activeId,
  onNavigate,
}: {
  workspaces: Workspace[];
  activeId: string | null;
  onNavigate?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = workspaces.find((w) => w.id === activeId) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  return (
    <div ref={ref} data-tour="workspace-switcher" className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="tap-target flex w-full items-center gap-2.5 rounded-lg border border-hairline bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand text-xs font-semibold text-white">
          {(active?.name ?? "W").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {active?.name ?? "Select a workspace"}
          </span>
        </span>
        <Icon path={icons.chevron} className="h-3.5 w-3.5 text-ink-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-hairline bg-surface-raised p-1 shadow-lg scroll-slim"
        >
          {workspaces.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-ink-muted">No workspaces yet</p>
          )}
          {workspaces.map((w) => (
            <Link
              key={w.id}
              href={`/workspace/${w.id}`}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              className={cx(
                "flex items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                w.id === activeId
                  ? "bg-brand-soft text-brand"
                  : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
              )}
            >
              <span className="truncate">{w.name}</span>
              <span className="shrink-0 text-xs uppercase tracking-wide text-ink-muted">
                {w.role}
              </span>
            </Link>
          ))}
          <div className="my-1 h-px bg-hairline" />
          <Link
            href="/workspace"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Icon path={icons.plus} />
            All workspaces
          </Link>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- shell -- */

export function AppShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Collapsed state is desktop-only and remembered; on mobile the sidebar is
  // an overlay drawer, which is a different control with different semantics.
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    getSidebarSnapshot,
    () => false,
  );

  const toggleCollapsed = () => setSidebarCollapsed(!collapsed);


  // The coachmark tour points at things in this sidebar. On a phone that's
  // a closed drawer and on a desktop it may be collapsed; either way the
  // overlay can't find its target and asks here, rather than knowing how the
  // shell is laid out. Closing is the reverse: a step whose target is on the
  // page itself must not be shown behind the drawer.
  useEffect(() => {
    function onOpen() {
      openDrawer();
      setSidebarCollapsed(false);
    }
    function onClose() {
      setMobileOpen(false);
    }
    window.addEventListener("clardentity:open-nav", onOpen);
    window.addEventListener("clardentity:close-nav", onClose);
    return () => {
      window.removeEventListener("clardentity:open-nav", onOpen);
      window.removeEventListener("clardentity:close-nav", onClose);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Workspace[]>("/workspaces")
      .then((ws) => {
        if (!cancelled) setWorkspaces(ws);
      })
      .catch(() => {
        // The shell must render even if this fails; the page below will
        // surface the real error from its own fetch.
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  // /workspace/<id> carries the workspace in the URL; /chat/<id> doesn't, so
  // it's resolved from the conversation. Without this the sidebar reads
  // "Select a workspace" while you are inside one of its conversations, and the
  // Artifacts/Chats links point at the workspace *list* - which makes it easy
  // to upload a document into one workspace and then ask questions in another,
  // and conclude that grounding is broken.
  const workspaceMatch = pathname.match(/^\/workspace\/([^/]+)/);
  const conversationId = pathname.match(/^\/chat\/([^/]+)/)?.[1] ?? null;
  // Keyed by conversation so a stale result is ignored by derivation rather
  // than cleared with a setState in the effect body (which cascades renders).
  const [resolved, setResolved] = useState<{
    id: string;
    workspaceId: string;
    title: string | null;
  } | null>(null);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    apiFetch<{ workspace_id: string; title: string | null }>(
      `/chat/conversations/${conversationId}`,
    )
      .then((conv) => {
        if (!cancelled) {
          setResolved({
            id: conversationId,
            workspaceId: conv.workspace_id,
            title: conv.title,
          });
        }
      })
      .catch(() => {
        // Sidebar just falls back to no active workspace; the page below
        // surfaces the real error.
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  const chatWorkspaceId =
    conversationId && resolved?.id === conversationId ? resolved.workspaceId : null;
  const activeWorkspaceId = workspaceMatch ? workspaceMatch[1] : chatWorkspaceId;
  // The entry route (/start) opens a chat in the workspace you were in last.
  useEffect(() => {
    if (activeWorkspaceId) rememberWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId]);
  const conversationTitle =
    conversationId && resolved?.id === conversationId ? resolved.title : null;
  // Which tour, if any, walks the page in view - drives the replay button.
  const tourHere: TourId | null = conversationId
    ? "chat"
    : /^\/workspace\/[^/]+$/.test(pathname)
      ? "workspace"
      : null;
  const [starting, setStarting] = useState(false);
  // Bumped after a conversation is created or deleted here, so the recents
  // list refetches without the sidebar owning the list itself.
  const [recentsKey, setRecentsKey] = useState(0);

  /* The drawer is a modal on a phone, so it behaves like one: it owns focus
     while open, Escape closes it, and the phone's Back button closes it
     rather than leaving the page under it. Back needs a history entry to
     consume, so opening pushes one (same URL, the router's own state copied
     so it restores the page untouched). */
  const drawerRef = useRef<HTMLElement>(null);
  const openNavRef = useRef<HTMLButtonElement>(null);
  const drawerEntry = useRef(false);

  // Closed by navigating somewhere from inside it: the link pushes on top of
  // the drawer's entry, which is skipped on the way back (below).
  const close = () => {
    drawerEntry.current = false;
    setMobileOpen(false);
  };
  // Closed in place (X, backdrop, Escape): spend the entry, and let the
  // popstate close it, so Back afterwards goes where it would have anyway.
  const dismiss = useCallback(() => {
    if (drawerEntry.current) window.history.back();
    else setMobileOpen(false);
  }, []);

  /* Swipe to close: the drawer follows a finger dragged left and closes past
     40% of its width or on a quick flick; anything shorter springs back.
     Close only - no edge-swipe to open, because a swipe in from the left edge
     is iOS Safari's own Back gesture and the two would fight. A drag can
     start anywhere, links included: once it's sideways the pointer is
     captured, so the link under the finger never receives a click. */
  const [dragX, setDragX] = useState(0); // layout px, 0 = fully open
  const [dragWidth, setDragWidth] = useState(1); // drawer width at drag start, layout px
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; y: number; t: number; axis: "x" | "y" | null } | null>(null);
  function openDrawer() {
    setDragX(0); // a swipe-close leaves the drawer parked off-screen
    setMobileOpen(true);
  }
  const drawerWidth = () => (drawerRef.current?.getBoundingClientRect().width ?? 0) / rectScale();

  function onDrawerPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (e.pointerType === "mouse") return; // a mouse has the X and the backdrop
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, axis: null };
  }
  function onDrawerPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d) return;
    const mx = e.clientX - d.x;
    const my = e.clientY - d.y;
    if (d.axis === null) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      // Up/down stays a scroll of the menu; only a sideways start is a swipe.
      d.axis = Math.abs(mx) > Math.abs(my) ? "x" : "y";
      if (d.axis === "x") {
        setDragging(true);
        setDragWidth(drawerWidth() || 1);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // a pointer the browser no longer tracks; the drag still works
        }
      }
    }
    if (d.axis !== "x") return;
    // clientX is screen pixels; the transform is in the zoomed layout's.
    setDragX(Math.min(0, mx) / rectScale());
  }
  function onDrawerPointerEnd(e: ReactPointerEvent<HTMLElement>, cancelled = false) {
    const d = drag.current;
    drag.current = null;
    if (!d || d.axis !== "x") return;
    setDragging(false);
    const travelled = Math.min(0, e.clientX - d.x) / rectScale();
    const speed = travelled / Math.max(1, e.timeStamp - d.t); // layout px per ms
    if (!cancelled && (-travelled > drawerWidth() * 0.4 || speed < -0.6)) {
      setDragX(-drawerWidth()); // finish the slide, then close
      setTimeout(dismiss, 180);
    } else {
      setDragX(0);
    }
  }

  useEffect(() => {
    if (!mobileOpen) return;
    if (!drawerEntry.current) {
      window.history.pushState({ ...window.history.state, clardentityDrawer: true }, "");
      drawerEntry.current = true;
    }
    function onPop() {
      drawerEntry.current = false;
      setMobileOpen(false);
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [mobileOpen]);

  // An entry left behind by a drawer that closed by navigating is the same
  // page twice; Back steps over it instead of appearing to do nothing.
  useEffect(() => {
    function onPop() {
      if (window.history.state?.clardentityDrawer && !drawerEntry.current) window.history.back();
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const drawer = drawerRef.current;
    const opener = openNavRef.current;
    drawer?.querySelector<HTMLElement>('button[aria-label="Close navigation"]')?.focus();
    function onKey(e: KeyboardEvent) {
      if (!drawer) return;
      if (e.key === "Escape") {
        // An open menu inside the drawer (workspaces, account) closes first.
        if (drawer.querySelector('[aria-expanded="true"]')) return;
        e.preventDefault();
        dismiss();
        return;
      }
      if (e.key !== "Tab") return;
      const items = [
        ...drawer.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = drawer.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus();
    };
  }, [mobileOpen, dismiss]);

  // A chat names itself after its first answer (see ChatView's final
  // handler): refresh the recents list and, if it's the one in view, the
  // breadcrumb - without a round trip for the latter.
  useEffect(() => {
    function onRenamed(e: Event) {
      const { id, title } = (e as CustomEvent<{ id: string; title: string }>).detail;
      setRecentsKey((k) => k + 1);
      setResolved((prev) => (prev && prev.id === id ? { ...prev, title } : prev));
    }
    window.addEventListener("clardentity:conversation-renamed", onRenamed);
    return () => window.removeEventListener("clardentity:conversation-renamed", onRenamed);
  }, []);

  async function startConversation() {
    if (starting) return;
    // No workspace in view (the profile page, the workspace list, /start
    // itself): the entry route picks one - the last used, else the first,
    // else a new one - and opens a chat there. The button is never dead.
    if (!activeWorkspaceId) {
      router.push("/start");
      return;
    }
    setStarting(true);
    try {
      const conv = await apiFetch<{ id: string }>("/chat/conversations", {
        method: "POST",
        body: { workspace_id: activeWorkspaceId, default_mode: null },
      });
      setRecentsKey((k) => k + 1);
      router.push(`/chat/${conv.id}`);
    } catch {
      // The room page has the same button with visible error handling; a
      // failure here should not put an error banner in the chrome.
    } finally {
      setStarting(false);
    }
  }

  /* Destinations first, then history, then the upsell - the shape every chat
     app has converged on, and for a reason: the thing you do most (start
     talking) is one click at the top, and the thing you do second most (pick
     up where you left off) is a list you scan rather than a page you navigate
     to. The old "Room / Account" section headings are gone; four items don't
     need to be filed under anything. */
  const nav = (
    <nav className="flex min-h-0 flex-1 flex-col p-3">
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeId={activeWorkspaceId}
        onNavigate={close}
      />

      <button
        type="button"
        onClick={() => {
          close();
          void startConversation();
        }}
        disabled={starting}
        className="tap-target mt-3 flex h-12 items-center gap-3 rounded-[9px] px-4 text-left text-sm text-[color:var(--text-nav)] transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
      >
        <MaskIcon src="/ui/nav-newchat.svg" size={24} />
        {starting ? "Starting…" : "New chat"}
      </button>

      <div className="mt-0.5 flex flex-col gap-0.5">
        {/* Real routes, not `#documents` anchors. As anchors these silently
            did nothing: a same-route hash is not re-scrolled by the App
            Router, and with no workspace resolved they fell back to the
            workspace list. */}
        {/* Three rows, as drawn. Workspaces is reached from the picker above
            rather than a row of its own, and Search replaces the old "Chats"
            - same destination, the name the design gives it. */}
        <NavItem
          href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/documents` : "/workspace"}
          iconSrc="/ui/nav-attachments.svg"
          active={pathname.endsWith("/documents")}
          onNavigate={close}
          tourId="nav-attachments"
        >
          Attachments
        </NavItem>
        <NavItem
          href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/search` : "/workspace"}
          iconSrc="/ui/nav-search.svg"
          active={pathname.endsWith("/search")}
          onNavigate={close}
          tourId="nav-chats"
        >
          Search
        </NavItem>
        {/* Only an administrator has anywhere to go here, and only the
            server knows who that is. Absent for everyone else rather than
            present and refusing, which would be an advertisement. */}
        {user?.is_admin && (
          <NavItem
            href="/admin"
            icon={icons.admin}
            active={pathname.startsWith("/admin")}
            onNavigate={close}
          >
            Admin
          </NavItem>
        )}
      </div>

      <ErrorBoundary where="recents" label="Recent chats couldn't be shown.">
        <RecentConversations
          workspaceId={activeWorkspaceId}
          workspaces={workspaces}
          activeId={conversationId}
          refreshKey={recentsKey}
          onNavigate={close}
        />
      </ErrorBoundary>

    </nav>
  );

  const account = (
    <div className="border-t border-hairline p-3">
      {/* The card is the way into everything the account can do. It used to
          be a link to the profile with a log-out icon bolted to its right -
          a door-with-an-arrow that only means "exit" to someone who already
          knows it does. The verbs are words in a menu now. */}
      <AccountMenu key={pathname} onNavigate={close} />
    </div>
  );

  return (
    // h-screen + overflow-hidden (not min-h-screen) so the shell is a bounded
    // box: the scroll container is <main>, which lets the chat view size its
    // message list to the viewport and keep the composer pinned. With an
    // unbounded shell the list's overflow-y-auto never engages and the page
    // grows past the viewport instead.
    <div className="flex h-[calc(var(--app-vh)*100)] overflow-hidden">
      {/* Greeting on arrival, and the demo conversation if one followed the
          user in. Here rather than on any one page: both are about opening
          the app, not about where you landed. */}
      <AppNotices />
      <OfflineNotice />
      {/* Desktop sidebar. Slides out of view rather than unmounting, so
          collapsing and re-opening doesn't refetch the workspace list or lose
          the switcher's open/closed state. */}
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-20 hidden w-[var(--sidebar-width)] flex-col border-r border-hairline bg-surface-muted transition-transform duration-200 lg:flex",
          collapsed && "-translate-x-full",
        )}
        aria-hidden={collapsed}
        // Keeps collapsed nav links out of the tab order; visibility:hidden
        // would kill the slide animation, and `inert` isn't in this React
        // version's JSX types yet.
        style={collapsed ? { pointerEvents: "none" } : undefined}
      >
        <div className="flex h-[var(--topbar-height)] items-center justify-between px-4">
          {/* The wordmark with its five-dot mark, as the design draws it, and
              no rule under it: the sidebar's own right-hand border is the
              only line at this corner. */}
          <Link href="/" className="flex items-center gap-[3.7px]">
            <MaskIcon
              src="/ui/logo-dots.svg"
              className="h-[22.275px] w-[23.029px] text-brand"
            />
            <span className="text-[18.563px] text-ink">Clardentity</span>
          </Link>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            tabIndex={collapsed ? -1 : undefined}
            className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <Icon path={icons.panelLeft} />
          </button>
        </div>
        {nav}
        {account}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={dismiss}
            className={cx("absolute inset-0 bg-black/40", !dragging && "transition-opacity duration-200")}
            style={{ opacity: dragX ? Math.max(0, 1 + dragX / dragWidth) : undefined }}
          />
          <aside
            ref={drawerRef}
            data-testid="nav-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            onPointerDown={onDrawerPointerDown}
            onPointerMove={onDrawerPointerMove}
            onPointerUp={(e) => onDrawerPointerEnd(e)}
            onPointerCancel={(e) => onDrawerPointerEnd(e, true)}
            className={cx(
              // pan-y on every descendant, not just the aside: a scroll box
              // inside (the recents list) resets touch-action, and there the
              // browser claimed the sideways drag and cancelled the swipe.
              "absolute inset-y-0 left-0 flex w-[var(--sidebar-width)] touch-pan-y flex-col border-r border-hairline bg-surface-muted [&_*]:touch-pan-y",
              !dragging && "transition-transform duration-200 ease-out",
              dragging && "select-none",
            )}
            style={{ transform: dragX ? `translateX(${dragX}px)` : undefined }}
          >
            <div data-safe="top" className="flex h-[var(--topbar-height)] items-center justify-between border-b border-hairline px-4">
              {/* Home, as the desktop sidebar's wordmark is. close(), not
                  dismiss(): this navigates, so the drawer's history entry is
                  left for the Back handler to step over. */}
              <Link
                href="/"
                onClick={close}
                className="tap-area -mx-1 inline-flex items-center gap-1.5 rounded-md px-1 text-sm font-semibold tracking-tight text-ink"
              >
                {/* the five-dot mark, as the desktop sidebar draws it */}
                <MaskIcon src="/ui/logo-dots.svg" className="h-[18px] w-[18.6px] shrink-0 text-brand" />
                Clardentity
              </Link>
              <button
                onClick={dismiss}
                aria-label="Close navigation"
                className="tap-target inline-flex items-center justify-center rounded-md p-1.5 text-ink-muted hover:bg-surface-hover"
              >
                <Icon path={icons.close} />
              </button>
            </div>
            {nav}
            {account}
          </aside>
        </div>
      )}

      <div
        className={cx(
          "flex min-w-0 flex-1 flex-col transition-[padding] duration-200",
          !collapsed && "lg:pl-[var(--sidebar-width)]",
        )}
      >
        <header data-safe="top" className="z-10 flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4 sm:px-6">
          {/* Two buttons rather than one that branches on viewport width: the
              mobile drawer and the desktop collapse are genuinely different
              controls, and inferring which one to run from a JS media query
              means the first render can pick wrong. */}
          <button
            ref={openNavRef}
            onClick={() => openDrawer()}
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            className="tap-target inline-flex items-center justify-center rounded-md p-1.5 text-ink-secondary hover:bg-surface-hover lg:hidden"
          >
            <Icon path={icons.menu} />
          </button>
          {collapsed && (
            <button
              onClick={toggleCollapsed}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="hidden rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink lg:block"
            >
              <Icon path={icons.menu} />
            </button>
          )}
          <Breadcrumbs
            pathname={pathname}
            workspaces={workspaces}
            activeWorkspaceId={activeWorkspaceId}
            conversationTitle={conversationTitle}
          />
          {/* One tap to a new chat on a phone, where the sidebar's button is
              behind the drawer. Desktop has the sidebar in view. */}
          <button
            type="button"
            onClick={() => void startConversation()}
            disabled={starting}
            aria-label="New chat"
            title="New chat"
            className="tap-target ml-auto inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-brand transition-colors hover:bg-surface-hover disabled:opacity-50 lg:hidden"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
              <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.3 9 9 0 0 1-3.9-.9L3 21l1.6-4.5A8.3 8.3 0 0 1 3.5 11.5 8.5 8.5 0 0 1 12.5 3a8.5 8.5 0 0 1 8.5 8.5z" />
              <path d="M12.5 8.5v6M9.5 11.5h6" />
            </svg>
          </button>
          <ThemeToggle className="shrink-0 lg:ml-auto" tourId="theme-toggle" />
          {tourHere && (
            // The coachmarks, again, on request - for anyone who skipped them
            // or wants a second look. Only where a tour exists for the page
            // in view; `force` because the whole point is replaying one this
            // browser has already finished.
            <button
              type="button"
              onClick={() => startTour(tourHere, { force: true })}
              title="Show me around this page"
              aria-label="Show me around this page"
              className="tap-target inline-flex shrink-0 items-center justify-center rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="h-4 w-4"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7" />
                <path d="M12 17h.01" />
              </svg>
            </button>
          )}
        </header>

        {/* While the phone menu is open the page under it holds still. */}
        <main className={cx("scroll-slim flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto", mobileOpen && "max-lg:overflow-hidden")}>
          {/* keyed by route: a page that failed gets a fresh start on the next one */}
          <ErrorBoundary key={pathname} where="page" variant="page" label="This page didn't load.">
            {children}
          </ErrorBoundary>
        </main>
      </div>

    </div>
  );
}

function Breadcrumbs({
  pathname,
  workspaces,
  activeWorkspaceId,
  conversationTitle,
}: {
  pathname: string;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  conversationTitle: string | null;
}) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return <span className="text-xl text-[color:var(--text-nav)]">Home</span>;
  }

  // Any route not listed here falls through to its raw path segment, which
  // is how /profile was rendering as a lowercase "profile" in a bar where
  // every other entry is a proper name.
  const LABELS: Record<string, string> = {
    workspace: "Workspaces",
    chat: "Conversation",
    profile: "Your profile",
    settings: "Settings",
    start: "Opening a chat",
  };

  const crumbs: Array<{ label: string; href?: string }> = [];
  const root = segments[0];

  // A conversation belongs to a workspace, so show that lineage rather than a
  // bare "Conversation" with no way back to the documents it is grounded in.
  if (root === "chat") {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    // Two crumbs, as drawn: the workspace this chat belongs to, then the
    // chat. "Workspaces /" in front of them was a third level the design
    // doesn't have, and the sidebar's picker is the way to the list anyway.
    if (ws) crumbs.push({ label: ws.name, href: `/workspace/${ws.id}` });
    else crumbs.push({ label: "Workspaces", href: "/workspace" });
    // The chat page no longer has a title bar of its own, so this crumb is
    // where the conversation is named. Until the title has been generated
    // from the first exchange it reads the way the sidebar does.
    crumbs.push({ label: conversationTitle || "New chat" });
    return <Crumbs crumbs={crumbs} />;
  }

  if (root === "workspace" && segments.length > 1) {
    // Inside a workspace the design starts at the workspace itself, not at
    // the list of them: "My workspace / Attachments", two crumbs.
    const id = segments[1];
    const ws = workspaces.find((w) => w.id === id);
    const name = ws?.name ?? "Workspace";
    const sub = segments[2];
    if (sub) {
      // Keep the workspace clickable when we're a level deeper.
      crumbs.push({ label: name, href: `/workspace/${id}` });
      crumbs.push({
        label: sub === "documents" ? "Attachments" : sub === "search" ? "Search" : sub,
      });
    } else {
      crumbs.push({ label: name });
    }
    return <Crumbs crumbs={crumbs} />;
  }

  crumbs.push({ label: LABELS[root] ?? root, href: `/${root}` });

  return <Crumbs crumbs={crumbs} />;
}

function Crumbs({ crumbs }: { crumbs: Array<{ label: string; href?: string }> }) {

  return (
    // 20px, and the three warm greys the design assigns: the trail in
    // #4d4339, its separators in #8b7b73, the page you are on in #5f5551.
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-2 text-xl">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-2">
            {i > 0 && <span className="text-[color:var(--text-nav-muted)]">/</span>}
            {last || !c.href ? (
              <span className="truncate text-[color:var(--text-nav)]">{c.label}</span>
            ) : (
              <Link
                href={c.href}
                className="truncate text-[color:var(--text-nav-strong)] transition-colors hover:text-ink"
              >
                {c.label}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
}
