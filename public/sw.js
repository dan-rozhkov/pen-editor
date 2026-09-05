// Tombstone service worker. Pen Editor no longer uses a service worker (see
// README / CLAUDE.md), but every browser that ever loaded a previous build
// still has the old workbox worker registered at this exact URL, and that
// worker serves its precached bundle instead of the network. Deleting this
// file would leave those clients pinned to a stale build forever — the only
// code we can still change for an already-registered client is the script at
// the URL it polls.
//
// DO NOT DELETE. Nothing in the app registers a worker any more, so a new
// visitor never fetches this file at all; it exists purely for the clients
// that already hold a registration. Verified end-to-end in chromium and
// webkit: a client pinned to a stale precache takes exactly one /sw.js
// fetch to end up unregistered, cacheless and reloaded onto the live
// bundle, with no reload loop.
//
// skipWaiting() lives in this script rather than depending on the old
// worker's config: the previous build used registerType "prompt", so a new
// worker would otherwise park in `waiting` until every tab of the origin
// closes — which on iOS Safari effectively never happens.

self.addEventListener("install", () => {
  self.skipWaiting();
});

// The editor route, resolved against this worker's own scope so it agrees
// with the app's router under any deploy base ("/" here, "/pen-editor/" on
// GitHub Pages). Mirrors the isEditorPath() helper this removal deleted,
// including the segment match — a bare startsWith("/app") would also claim a
// hypothetical "/appstore".
function isEditorClient(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  const pathname = new URL(url).pathname;
  const unprefixed =
    scopePath !== "/" && pathname.startsWith(scopePath)
      ? pathname.slice(scopePath.length - 1)
      : pathname;
  return unprefixed === "/app" || unprefixed.startsWith("/app/");
}

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache this origin holds. The old worker's precache is the
      // thing actually serving stale HTML/JS, and its names are workbox's, so
      // clear them all rather than guessing prefixes.
      //
      // Guarded because unregister() below is the step that actually matters:
      // the Cache API rejects outright in some states (Safari private
      // browsing, storage pressure), and an activate handler that rejects is
      // never retried — the worker still reaches "activated", so a thrown
      // cache sweep would strand the registration forever on exactly the
      // clients this file exists to free.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      } catch {
        // Best effort; without the registration nothing consults these
        // caches anyway, and the browser evicts them with the origin.
      }

      // Unregister before navigating, so the reload below comes back
      // uncontrolled and hits the network for real.
      await self.registration.unregister();

      // Reload the tabs this worker was controlling; without this they keep
      // running the stale bundle until the user happens to reload. There is
      // no loop risk: after unregister() nothing controls them again, and
      // the bundle they land on registers nothing.
      //
      // The editor is excluded, and that exclusion is not optional: a "/app"
      // document lives entirely in memory (no autosave, no beforeunload
      // prompt — see sceneStore/documentStore), so navigating that tab would
      // throw away unsaved work with no warning. The removed update machinery
      // drew the same line for the same reason: only the showcase ever
      // reloaded itself, the editor was always asked first. An editor tab
      // therefore keeps its already-loaded bundle until the user reloads it —
      // which is fine, because the registration and caches are gone by then,
      // so that reload (and every later one) hits the network.
      //
      // Best-effort per tab: navigate() rejects for a client the browser no
      // longer considers ours, and an unhandled rejection here would fail
      // the activation that just did the important work (caches cleared,
      // registration dropped) for every other tab too.
      const clients = await self.clients.matchAll({ type: "window" });
      for (const client of clients) {
        if (isEditorClient(client.url)) continue;
        client.navigate(client.url).catch(() => {});
      }
    })(),
  );
});
