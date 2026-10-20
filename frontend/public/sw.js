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

// Bumping this name is how a deploy drops everything the last one cached:
// `activate` deletes every cache that isn't this one.
//
// v4: the Co-Creative image card shipped and did not reach anyone who had
// the app open before it - the static chunks are served cache-first, so a
// browser holding v3 kept running a bundle with no card in it and the
// feature read as broken while the server was generating pictures
// perfectly well. Bump this whenever a shipped fix has to reach an existing
// tab, not just a new one.
//
// v5: the landing demo became the real chat UI, and the composer, the
// message list and two of the stores all changed to do it. Verifying any of
// that against a v4 cache measured the old bundle - twice in one sitting,
// which is the same hour lost as last time.
//
// v6: the greetings and the demo-to-account handoff. The handoff reads a
// transcript left in localStorage by a *previous* build of the landing
// page, so a browser running v5 chunks against a v6 deploy is exactly the
// case this has to survive.
//
// v7: the tracker batch - a Log in link in the landing nav, and the entry
// route now calling /bootstrap instead of three endpoints in a row. An old
// bundle would keep making the three calls against a backend that has the
// one, which works but is the slowness we just removed.
//
// v8: the end-to-end pass. "Skip for now" on the welcome questions was
// discarding answers already typed - a bundle still doing that would keep
// throwing away the one thing a new account tells us about itself.
//
// v9: smart switching in the demo and the new welcome copy. The demo's
// client now sends smart_switching and reads a "switched" event; an old
// bundle would send neither and show neither.
const CACHE = "clardentity-shell-v25"; // v25: the decision box says what its crossed-out choices are

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

  const save = (response) => {
    if (response.ok && response.type === "basic") {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  };

  // Next's build output is content-addressed: the filename changes whenever
  // the file does, so a hit is always the right file and cache-first is free.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then(save)));
    return;
  }

  // Everything else we serve - the design's icons, the app icons, the
  // manifest - keeps its name when its contents change, so cache-first would
  // pin someone to the version they first loaded and never let go. Serve the
  // cached copy for speed, then replace it in the background, so the change
  // lands on the next visit instead of never.
  event.respondWith(
    caches.match(request).then((hit) => {
      const fresh = fetch(request).then(save);
      return hit ?? fresh;
    }),
  );
});
