"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { apiFetch } from "@/lib/apiClient";
import { useAuth } from "@/lib/auth";
import { cx } from "@/components/ui/primitives";

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
  chat: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></>,
  docs: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>,
  library: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.44.62.79.75H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  chevron: <><path d="m6 9 6 6 6-6" /></>,
  logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></>,
  menu: <><path d="M3 6h18M3 12h18M3 18h18" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
};

/* ------------------------------------------------------------- sidebar -- */

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
            {active?.name ?? "Select workspace"}
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
            All workspaces
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

  // /workspace/<id> and /chat/<id> both imply a workspace; only the former
  // carries it in the URL, so chat pages fall back to no active workspace
  // rather than guessing.
  const workspaceMatch = pathname.match(/^\/workspace\/([^/]+)/);
  const activeWorkspaceId = workspaceMatch ? workspaceMatch[1] : null;
  const close = () => setMobileOpen(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-3 scroll-slim">
      <WorkspaceSwitcher
        workspaces={workspaces}
        activeId={activeWorkspaceId}
        onNavigate={close}
      />

      <p className="px-2.5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        Workspace
      </p>
      <NavItem
        href={activeWorkspaceId ? `/workspace/${activeWorkspaceId}` : "/workspace"}
        icon={icons.chat}
        active={pathname.startsWith("/workspace") || pathname.startsWith("/chat")}
        onNavigate={close}
      >
        Conversations
      </NavItem>
      <NavItem
        href={
          activeWorkspaceId
            ? `/workspace/${activeWorkspaceId}#documents`
            : "/workspace"
        }
        icon={icons.docs}
        active={false}
        onNavigate={close}
      >
        Documents
      </NavItem>
      <NavItem
        href={
          activeWorkspaceId ? `/workspace/${activeWorkspaceId}#search` : "/workspace"
        }
        icon={icons.search}
        active={false}
        onNavigate={close}
      >
        Search history
      </NavItem>

      <p className="px-2.5 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        Reference
      </p>
      <NavItem
        href="/biases"
        icon={icons.library}
        active={pathname.startsWith("/biases")}
        onNavigate={close}
      >
        Bias library
      </NavItem>
      <NavItem
        href="/admin"
        icon={icons.settings}
        active={pathname.startsWith("/admin")}
        onNavigate={close}
      >
        Admin settings
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
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[var(--sidebar-width)] flex-col border-r border-hairline bg-surface-muted lg:flex">
        <div className="flex h-[var(--topbar-height)] items-center border-b border-hairline px-4">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink">
            Clardentity
          </Link>
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

      <div className="flex min-w-0 flex-1 flex-col lg:pl-[var(--sidebar-width)]">
        <header className="z-10 flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-hairline bg-surface px-4 sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-1.5 text-ink-secondary hover:bg-surface-hover lg:hidden"
          >
            <Icon path={icons.menu} />
          </button>
          <Breadcrumbs pathname={pathname} workspaces={workspaces} />
        </header>

        <main className="scroll-slim flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}

function Breadcrumbs({
  pathname,
  workspaces,
}: {
  pathname: string;
  workspaces: Workspace[];
}) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return <span className="text-sm font-medium text-ink">Home</span>;
  }

  const LABELS: Record<string, string> = {
    workspace: "Workspaces",
    chat: "Conversation",
    biases: "Bias library",
    admin: "Admin settings",
  };

  const crumbs: Array<{ label: string; href?: string }> = [];
  const root = segments[0];
  crumbs.push({ label: LABELS[root] ?? root, href: `/${root}` });

  if (segments.length > 1) {
    const id = segments[1];
    if (root === "workspace") {
      const ws = workspaces.find((w) => w.id === id);
      crumbs.push({ label: ws?.name ?? "Workspace" });
    } else if (root === "biases") {
      crumbs.push({ label: "Detail" });
    }
  }

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
