/* Service worker, present mainly so the app is installable.
 *
 * Chrome will not offer "install" without a service worker that handles
 * fetch, so this exists to satisfy that and to make a cold launch of the
 * installed app feel instant - not to make the app work offline. An AI
 * companion with no network is a text box that can't answer anything, and
 * caching answers would be actively wrong: every response here is scored
 * against sources that can change.
 *
 * So the strategy is deliberately narrow: cache the static build output,
 * never cache API traffic, and always go to the network for pages.
 */

const CACHE = "clardentity-shell-v1";

// Only things that are content-addressed or genuinely static. HTML is not
// here on purpose - a stale shell is how a deployed fix fails to reach
// someone for a week.
const PRECACHE = ["/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that isn't a plain GET of our own origin is none of this
  // worker's business - and that deliberately includes every API call, the
  // SSE stream and the realtime session.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  // Navigations always hit the network. Serving a cached document would pin
  // users to whichever build they first opened.
  if (request.mode === "navigate") return;

  // Everything else: cache first, since Next's static assets carry hashed
  // filenames and a hit is always the right file.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ??
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
