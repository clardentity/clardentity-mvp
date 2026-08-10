"use client";

import { useEffect, type ReactNode } from "react";

export type Theme = "light" | "dark";

const STORAGE_KEY = "clardentity-theme";

/* Runs before first paint, inlined into <head>. Without it the page renders
   once with the light tokens and then swaps, which on a dark-mode machine is a
   full-screen white flash on every fresh document load.

   Kept in sync by hand with applyTheme() below - it has to be a plain string
   because it executes before any bundle has loaded. */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem(${JSON.stringify(STORAGE_KEY)});
    var theme = stored === "light" || stored === "dark"
      ? stored
      : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  } catch (e) {}
})();
`;

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Drives the native bits CSS variables can't reach: form controls, the
  // scrollbar gutter, and the canvas behind an over-scroll bounce.
  document.documentElement.style.colorScheme = theme;
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Flip the theme and remember the choice.
 *
 *  Deliberately not React state: the <html> attribute set by the init script
 *  is already the single source of truth, and mirroring it into a hook would
 *  mean the server renders one value, hydration renders another, and the
 *  toggle flickers on every page load. Nothing re-renders here - the CSS
 *  keyed on [data-theme] does all the work.
 */
export function toggleTheme() {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  localStorage.setItem(STORAGE_KEY, next);
  applyTheme(next);
}

/** Keeps the app following the OS until the user picks a side themselves. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange(e: MediaQueryListEvent) {
      if (localStorage.getItem(STORAGE_KEY)) return;
      applyTheme(e.matches ? "dark" : "light");
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return <>{children}</>;
}
