"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/system/ThemeToggle";
import { UpgradeDialog } from "@/components/chat/UpgradeDialog";
import { cx } from "@/components/ui/primitives";

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
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  profile: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  panelLeft: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18" /></>,
  trash: <><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
};

/* ------------------------------------------------------------- sidebar -- */

type RecentConversation = { id: string; title: string | null; created_at: string };

/** Recent conversations in the active room.
 *
 *  Its own component so the sidebar doesn't re-render on every keystroke of a
 *  fetch it doesn't own, and so "no room selected" is one early return rather
 *  than a condition threaded through the nav. */
function RecentConversations({
  workspaceId,
  activeId,
  refreshKey,
  onNavigate,
}: {
  workspaceId: string | null;
  activeId: string | null;
  refreshKey: number;
  onNavigate?: () => void;
}) {
  const [items, setItems] = useState<RecentConversation[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    apiFetch<RecentConversation[]>(`/chat/conversations?workspace_id=${workspaceId}`)
      .then((rows) => {
        if (!cancelled) setItems(rows.slice(0, 12));
      })
      .catch(() => {
        // A sidebar that can't list history is not worth an error state; the
        // room page below shows the same list with one.
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, refreshKey, activeId]);

  async function remove(id: string) {
    setConfirming(null);
    setItems((prev) => prev.filter((c) => c.id !== id));
    try {
      await apiFetch(`/chat/conversations/${id}`, { method: "DELETE" });
    } catch {
      return;
    }
    // Deleting the chat you are reading has to move you somewhere that still
    // exists, or the next render fetches a 404.
    if (id === activeId) router.push(workspaceId ? `/workspace/${workspaceId}` : "/workspace");
  }

  if (!workspaceId || items.length === 0) return <div className="flex-1" />;

  return (
    <div className="mt-5 flex min-h-0 flex-1 flex-col">
      <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        Recents
      </p>
      <ul className="scroll-slim min-h-0 flex-1 overflow-y-auto">
        {items.map((c) => (
          <li key={c.id} className="group/recent flex items-center">
            <Link
              href={`/chat/${c.id}`}
              onClick={onNavigate}
              aria-current={c.id === activeId ? "page" : undefined}
              className={cx(
                "min-w-0 flex-1 truncate rounded-lg py-1.5 pl-2.5 pr-1.5 text-[13px] transition-colors",
                c.id === activeId
                  ? "bg-surface-hover font-medium text-ink"
                  : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
              )}
            >
              {c.title || "Untitled conversation"}
            </Link>
            {/* Both controls sit in the row rather than over it. The trash icon
                fitted the reserved padding; "Sure?" is nearly twice as wide and
                printed straight over the end of the title. Held in flow, the
                title just truncates earlier - which is what truncation is for. */}
            {confirming === c.id ? (
              <button
                type="button"
                onClick={() => remove(c.id)}
                onBlur={() => setConfirming(null)}
                autoFocus
                className="mr-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-band-low"
              >
                Sure?
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setConfirming(c.id)}
                title="Delete conversation"
                aria-label={`Delete ${c.title || "Untitled conversation"}`}
                className="mr-1 shrink-0 rounded p-1 text-ink-muted opacity-0 transition-opacity hover:text-band-low focus-visible:opacity-100 group-hover/recent:opacity-100"
              >
                <Icon path={icons.trash} className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function NavItem({
  href,
  icon,
  children,
  active,
  onNavigate,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-brand-soft font-medium text-brand"
          : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
      )}
    >
      <Icon path={icon} />
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
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-lg border border-hairline bg-surface px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand text-[11px] font-semibold text-white">
          {(active?.name ?? "W").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {active?.name ?? "Select a room"}
          </span>
        </span>
        <Icon path={icons.chevron} className="h-3.5 w-3.5 text-ink-muted" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-hairline bg-surface p-1 shadow-lg scroll-slim"
        >
          {workspaces.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-ink-muted">No rooms yet</p>
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
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-muted">
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
            All rooms
          </Link>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- shell -- */

export function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
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
  // "Select a room" while you are inside one of its conversations, and the
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
  const conversationTitle =
    conversationId && resolved?.id === conversationId ? resolved.title : null;
  const [starting, setStarting] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  // Bumped after a conversation is created or deleted here, so the recents
  // list refetches without the sidebar owning the list itself.
  const [recentsKey, setRecentsKey] = useState(0);
  const close = () => setMobileOpen(false);

  async function startConversation() {
    if (starting || !activeWorkspaceId) return;
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
        disabled={starting || !activeWorkspaceId}
        className="mt-3 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-brand transition-colors hover:bg-surface-hover disabled:opacity-50"
      >
        <span className="flex h-4 w-4 items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" aria-hidden="true" className="h-4 w-4">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        {starting ? "Starting…" : "New chat"}
      </button>

      <div className="mt-0.5 flex flex-col gap-0.5">
        {/* Real routes, not `#documents` anchors. As anchors these silently
            did nothing: a same-route hash is not re-scrolled by the App
            Router, and with no workspace resolved they fell back to the
            workspace list. */}
        <NavItem
          href="/workspace"
          icon={icons.rooms}
          active={pathname === "/workspace"}
          onNavigate={close}
        >
          Rooms
        </NavItem>
        <NavItem
          href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/documents` : "/workspace"}
          icon={icons.docs}
          active={pathname.endsWith("/documents")}
          onNavigate={close}
        >
          Attachments
        </NavItem>
        <NavItem
          href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}/search` : "/workspace"}
          icon={icons.search}
          active={pathname.endsWith("/search")}
          onNavigate={close}
        >
          Chats
        </NavItem>
      </div>

      <RecentConversations
        workspaceId={activeWorkspaceId}
        activeId={conversationId}
        refreshKey={recentsKey}
        onNavigate={close}
      />

      <button
        type="button"
        onClick={() => setUpgradeOpen(true)}
        className="mt-2 flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink"
      >
        <span className="flex h-4 w-4 items-center justify-center text-brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
            strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-4 w-4">
            <path d="M12 3l2.4 5.3 5.6.6-4.2 3.9 1.2 5.7L12 15.8 6.9 18.5l1.2-5.7L4 8.9l5.6-.6z" />
          </svg>
        </span>
        Upgrade
      </button>
      <NavItem
        href="/profile"
        icon={icons.profile}
        active={pathname.startsWith("/profile")}
        onNavigate={close}
      >
        Your profile
      </NavItem>
    </nav>
  );

  const account = (
    <div className="border-t border-hairline p-3">
      <div className="flex items-center gap-2.5 rounded-lg px-1 py-1">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[11px] font-semibold text-ink-secondary">
          {(user?.display_name || user?.email || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">
            {user?.display_name || "Signed in"}
          </span>
          <span className="block truncate text-xs text-ink-muted">{user?.email}</span>
        </span>
        <button
          type="button"
          title="Log out"
          aria-label="Log out"
          onClick={() => {
            logout();
            router.push("/login");
          }}
          className="rounded-md p-1.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <Icon path={icons.logout} />
        </button>
      </div>
    </div>
  );

  return (
    // h-screen + overflow-hidden (not min-h-screen) so the shell is a bounded
    // box: the scroll container is <main>, which lets the chat view size its
    // message list to the viewport and keep the composer pinned. With an
    // unbounded shell the list's overflow-y-auto never engages and the page
    // grows past the viewport instead.
    <div className="flex h-screen overflow-hidden">
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
        <div className="flex h-[var(--topbar-height)] items-center justify-between border-b border-hairline px-4">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink">
            Clardentity
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
            onClick={close}
            className="absolute inset-0 bg-black/40"
          />
          <aside className="absolute inset-y-0 left-0 flex w-[var(--sidebar-width)] flex-col border-r border-hairline bg-surface-muted">
            <div className="flex h-[var(--topbar-height)] items-center justify-between border-b border-hairline px-4">
              <span className="text-[15px] font-semibold tracking-tight text-ink">
                Clardentity
              </span>
              <button
                onClick={close}
                aria-label="Close navigation"
                className="rounded-md p-1.5 text-ink-muted hover:bg-surface-hover"
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
        <header className="z-10 flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4 sm:px-6">
          {/* Two buttons rather than one that branches on viewport width: the
              mobile drawer and the desktop collapse are genuinely different
              controls, and inferring which one to run from a JS media query
              means the first render can pick wrong. */}
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-hover lg:hidden"
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
          <ThemeToggle className="ml-auto shrink-0" />
        </header>

        <main className="scroll-slim flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>

      {/* Lives at shell level so the sidebar's Upgrade works from every page,
          not only the ones with a composer on them. */}
      <UpgradeDialog open={upgradeOpen} onClose={() => setUpgradeOpen(false)} />
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
    return <span className="text-sm font-medium text-ink">Home</span>;
  }

  // Any route not listed here falls through to its raw path segment, which
  // is how /profile was rendering as a lowercase "profile" in a bar where
  // every other entry is a proper name.
  const LABELS: Record<string, string> = {
    workspace: "Rooms",
    chat: "Conversation",
    profile: "Your profile",
  };

  const crumbs: Array<{ label: string; href?: string }> = [];
  const root = segments[0];

  // A conversation belongs to a workspace, so show that lineage rather than a
  // bare "Conversation" with no way back to the documents it is grounded in.
  if (root === "chat") {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    crumbs.push({ label: "Rooms", href: "/workspace" });
    if (ws) crumbs.push({ label: ws.name, href: `/workspace/${ws.id}` });
    // The chat page no longer has a title bar of its own, so this crumb is
    // where the conversation is named. It falls back to the generic label
    // until the title has been generated from the first exchange.
    crumbs.push({ label: conversationTitle || "Conversation" });
    return <Crumbs crumbs={crumbs} />;
  }

  crumbs.push({ label: LABELS[root] ?? root, href: `/${root}` });

  if (segments.length > 1) {
    const id = segments[1];
    if (root === "workspace") {
      const ws = workspaces.find((w) => w.id === id);
      const name = ws?.name ?? "Room";
      const sub = segments[2];
      if (sub) {
        // Keep the workspace clickable when we're a level deeper.
        crumbs.push({ label: name, href: `/workspace/${id}` });
        crumbs.push({
          label: sub === "documents" ? "Attachments" : sub === "search" ? "Chats" : sub,
        });
      } else {
        crumbs.push({ label: name });
      }
    }
  }

  return <Crumbs crumbs={crumbs} />;
}

function Crumbs({ crumbs }: { crumbs: Array<{ label: string; href?: string }> }) {

  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
      {crumbs.map((c, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && <span className="text-ink-muted">/</span>}
            {last || !c.href ? (
              <span className="truncate font-medium text-ink">{c.label}</span>
            ) : (
              <Link
                href={c.href}
                className="truncate text-ink-muted transition-colors hover:text-ink"
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
