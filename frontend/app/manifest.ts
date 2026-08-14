import type { MetadataRoute } from "next";

/* Installable as a desktop and mobile app.
 *
 * `display: standalone` is what turns the browser's "Open in app" affordance
 * on and gives the installed copy its own window with no address bar - which
 * is the whole point: a companion you keep open beside your work shouldn't
 * look like a tab you'll close by accident.
 *
 * start_url is /workspace rather than /: signed-in users are who install
 * apps, and landing them on the marketing page every launch is a redirect
 * they'd have to sit through. Signed-out users get bounced to /login by
 * RequireAuth, which is where they were going anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clardentity",
    short_name: "Clardentity",
    description:
      "Your lifelong thinking companion. Every claim scored, every source shown.",
    start_url: "/workspace",
    scope: "/",
    display: "standalone",
    // True black to match the app's own canvas, so the splash and the window
    // chrome don't flash white before the first paint.
    background_color: "#000000",
    theme_color: "#000000",
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
