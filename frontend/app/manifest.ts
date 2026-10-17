import type { MetadataRoute } from "next";

/* Installable as a desktop and mobile app.
 *
 * `display: standalone` is what turns the browser's "Open in app" affordance
 * on and gives the installed copy its own window with no address bar - which
 * is the whole point: a companion you keep open beside your work shouldn't
 * look like a tab you'll close by accident.
 *
 * start_url is /start rather than /: signed-in users are who install apps,
 * and landing them on the marketing page every launch is a redirect they'd
 * have to sit through. /start is where signing in on the website lands too -
 * it opens a chat (the last workspace's empty chat, or a new one) - so the
 * installed app and the website start in the same place. It used to be
 * /workspace, which put app users on the workspace list instead. Signed-out
 * users get bounced to /login by RequireAuth, which is where they were going
 * anyway.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clardentity",
    short_name: "Clardentity",
    description:
      "Your lifelong thinking companion. Every claim scored, every source shown.",
    start_url: "/start",
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
