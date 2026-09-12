"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { cx } from "@/components/ui/primitives";

/* "Download the app" for a PWA.
 *
 * The manifest, icons and service worker were all in place and installable
 * by every browser's own test - but nothing in the UI ever said so, Chrome
 * hides the offer in its address bar, and iOS Safari never prompts at all
 * (Add to Home Screen is a manual Share-sheet step). So "app download is not
 * working" was really "there is nothing to click". This gives people the
 * button: it triggers the browser's own install prompt where one exists,
 * and shows the two-step instruction where it doesn't. Hidden once running
 * as an installed app. */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

type Environment = "server" | "installed" | "ios" | "other";

/** Read once from the browser; a stable string so useSyncExternalStore is
 *  happy. The server snapshot renders nothing, so a fresh visitor's HTML
 *  matches what a crawler sees and the real button appears after hydration. */
function getEnvironment(): Environment {
  if (typeof window === "undefined") return "server";
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own flag for a home-screen launch.
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as a Mac; the touch-point check tells them apart.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "other";
}

function subscribeNever() {
  return () => {};
}

export function InstallAppButton({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}) {
  const environment = useSyncExternalStore(subscribeNever, getEnvironment, () => "server" as const);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installedNow, setInstalledNow] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);

  useEffect(() => {
    function onPrompt(e: Event) {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalledNow(true);
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (environment === "server" || environment === "installed" || installedNow) return null;
  // Chromium fires beforeinstallprompt only when the app is installable and
  // not yet installed; without it (Firefox, desktop Safari) there is nothing
  // this button could do, so it stays out of the way rather than promising
  // an install it can't deliver.
  if (environment === "other" && !deferred) return null;

  async function handleClick() {
    if (deferred) {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") setInstalledNow(true);
      setDeferred(null);
      return;
    }
    setShowIosSteps((v) => !v);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button type="button" onClick={handleClick} className={cx(className)}>
        {children ?? "Install app"}
      </button>
      {environment === "ios" && showIosSteps && (
        <p className="rounded-lg border border-hairline bg-surface-muted px-3 py-2 text-xs leading-relaxed text-ink-secondary">
          In Safari, tap <span className="font-medium text-ink">Share</span> (the square with
          an arrow), then <span className="font-medium text-ink">Add to Home Screen</span>.
        </p>
      )}
    </div>
  );
}
