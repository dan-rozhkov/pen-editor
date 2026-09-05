import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// This app deliberately ships no service worker (see README). Two things have
// to stay true for that decision to keep holding, and neither is visible from
// any other test:
//
//  1. `public/sw.js` must keep existing. It is a tombstone: browsers that
//     loaded a pre-removal build still have the old workbox worker registered
//     at that exact URL, and they poll it. If the file is ever tidied away as
//     "dead code", those clients silently fall back to serving their stale
//     precache forever — the failure this removal was meant to end.
//  2. Nothing may register a worker again. A single stray `register()` would
//     re-create the caching layer (and, because the tombstone unregisters
//     itself, would fight it).

const repoRoot = path.resolve(__dirname, "../..");
const sw = readFileSync(path.join(repoRoot, "public/sw.js"), "utf8");

// Collected at module scope, and written branch-free: the lint config bans
// `if` anywhere in a test file (vitest/no-conditional-tests), and a recursive
// directory walk is otherwise nothing but branches.
function collectSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir).map((entry) => ({ entry, full: path.join(dir, entry) }));
  const dirs = entries.filter((e) => statSync(e.full).isDirectory());
  const files = entries.filter((e) => !dirs.includes(e));
  return [
    ...files.filter((e) => /\.(ts|tsx)$/.test(e.entry)).map((e) => e.full),
    // Skip __tests__ — this very file spells out the call being forbidden.
    ...dirs.filter((e) => e.entry !== "__tests__").flatMap((e) => collectSourceFiles(e.full)),
  ];
}

const REGISTER_CALL = /serviceWorker\s*\.\s*register\s*\(/;
const PWA_VIRTUAL_MODULE = /virtual:pwa-register/;

const scannedFiles = collectSourceFiles(path.join(repoRoot, "src"));
const registrationSites = scannedFiles
  .filter((file) => {
    const source = readFileSync(file, "utf8");
    return REGISTER_CALL.test(source) || PWA_VIRTUAL_MODULE.test(source);
  })
  .map((file) => path.relative(repoRoot, file));

describe("service worker removal", () => {
  it("keeps the tombstone worker at the URL old clients poll", () => {
    // Activation must not depend on the old worker's "prompt" config, which
    // would park this one in `waiting` until every tab closes.
    expect(sw).toContain("skipWaiting()");
    // The three things that actually free a stuck client.
    expect(sw).toContain("caches.delete");
    expect(sw).toContain("self.registration.unregister()");
    expect(sw).toContain("client.navigate(");
  });

  it("never force-reloads an editor tab", () => {
    // A "/app" document is in-memory only — no autosave, no beforeunload
    // prompt — so navigating that tab would discard unsaved work silently.
    // The worker frees it (unregister + cache sweep) but leaves the reload
    // to the user. Losing this line loses a user's document, and no other
    // test can see it: the worker never runs under Vitest.
    expect(sw).toContain("isEditorClient(client.url)");
    expect(sw).toContain('unprefixed === "/app"');
  });

  it("serves nothing from the tombstone", () => {
    // A fetch handler would put this worker back in the request path for
    // every navigation — the opposite of retiring it.
    expect(sw).not.toContain('addEventListener("fetch"');
    expect(sw).not.toContain("addEventListener('fetch'");
  });

  it("never registers a service worker from app code", () => {
    // Guards against a vacuous pass: an empty list would also satisfy the
    // assertion below if the walk ever stopped finding anything.
    expect(scannedFiles.length).toBeGreaterThan(100);
    expect(registrationSites).toEqual([]);
  });
});
