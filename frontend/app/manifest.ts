import type { MetadataRoute } from "next";

/* Installable as a desktop and mobile app.
 *
 * `display: standalone` is what turns the browser's "Open in app" affordance
 * on and gives the installed copy its own window with no address bar - which
 * is the whole point: a companion you keep open beside your work shouldn't
 * look like a tab you'll close by accident.
 *
 * start_url is /launch (2026-10-20): signed in, a new chat - the same road
 * sign-in takes; signed out, the home page at clardentity.ai rather than the
 * login form. It was /workspace until PR #6 (live 2026-10-18), which opened the
 * workspace list, then /start, which sent a signed-out launch to /login.
 *
 * `id` pins the app's identity to what installs already carry. With no id,
 * Chrome takes the start_url at install time as the identity - /workspace
 * for every copy installed before then - and a manifest whose identity
 * no longer matches is a different app, so those phones never learned the
 * new start_url and kept opening the workspace list. Keeping the old
 * identity lets Chrome update them in place (it checks the manifest when the
 * app opens). The id is a name, not a page: it is never navigated to.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clardentity",
    short_name: "Clardentity",
    description:
      "Your lifelong thinking companion. Every claim scored, every source shown.",
    id: "/workspace",
    start_url: "/launch",
    scope: "/",
    display: "standalone",
    // The dark canvas, which the icon's burgundy sits on cleanly. It was
    // true black, chosen when the dark theme was black; the rebuilt dark
    // palette has no #000 in it, so the splash was painting a colour that
    // appears nowhere in the app it opens into.
    background_color: "#121013",
    theme_color: "#121013",
    orientation: "any",
    categories: ["productivity", "education", "utilities"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Separate maskable entry: Android crops icons to its own shape, and an
      // "any" icon cropped that way loses the antenna.
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
