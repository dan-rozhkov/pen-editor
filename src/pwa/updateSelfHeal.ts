import { usePwaStore } from "@/store/pwaStore";

// PWA update / crash-recovery logic, kept entirely out of React.
//
// This used to live inside PwaUpdateGate: a useState snapshot of the
// "already auto-applied" flag plus a mount effect that fired the update.
// That broke down exactly when it mattered most — a stale bundle whose first
// render throws (a real incident: workbox prompt-mode served an old chunk
// that crashed on a changed `/api/showcase` response shape) never reaches
// PwaUpdateGate's effect, because the effect only runs after a successful
// commit. The self-heal is the recovery for a tree that failed to mount, so
// it cannot depend on that tree mounting. Everything here is plain module
// state and functions, callable from registerServiceWorker's callback (no
// React involved at all) and from RootErrorBoundary / a top-level `error`
// listener (React already failed by the time those run).

type UpdateSW = (reloadPage?: boolean) => Promise<void>;

// Set by registerServiceWorker() once registerSW() resolves. Lives here
// rather than in registerServiceWorker.ts itself so that both
// registerServiceWorker.ts (producer) and this module (consumer, via
// applyUpdateNow) can reach it without importing each other.
let updateSW: UpdateSW | undefined;

export function setUpdateSW(fn: UpdateSW | undefined) {
  updateSW = fn;
}

export function getUpdateSW(): UpdateSW | undefined {
  return updateSW;
}

// Marks "this tab already tried to auto-activate a waiting worker this
// session". Guards against a reload loop: if activation didn't take (the
// same version is still waiting on the next load), stop trying and fall back
// to the prompt instead of reloading forever.
export const AUTO_APPLY_KEY = "pen.pwaAutoApplied";

// Separate key (and separate one-shot guard) for the crash-recovery path —
// it can fire from a completely different trigger (a thrown render error)
// than a normal onNeedRefresh, so it needs its own "did this already happen"
// memory rather than reusing AUTO_APPLY_KEY.
const CRASH_RECOVERED_KEY = "pen.pwaCrashRecovered";

function readSessionFlag(key: string): boolean {
  try {
    return sessionStorage.getItem(key) !== null;
  } catch {
    // Safari private mode throws on any sessionStorage access. Treat as
    // "never tried" — the worst case is one extra prompt or reload, not a
    // crash loop, since private-mode sessionStorage can't persist a flag
    // across the reload we'd otherwise loop on anyway.
    return false;
  }
}

function writeSessionFlag(key: string) {
  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // See readSessionFlag — nothing to recover from a private-mode throw.
  }
}

function clearSessionFlag(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // ignore, same as above
  }
}

// Read once at module init — before React's first render — and cleared
// immediately: a successful auto-apply reloads into a build with nothing
// waiting, so the next load starts clean, while a failed one still sees the
// flag from before the reload and falls back to the prompt instead of
// reloading forever. Reading this as a constant at import time (instead of
// the old useState-snapshot-in-a-component) means it can never race
// component mount order, because there's no component in the loop anymore.
export const autoApplyAlreadyTried = readSessionFlag(AUTO_APPLY_KEY);
clearSessionFlag(AUTO_APPLY_KEY);

// AppRouter mounts `<BrowserRouter basename={import.meta.env.BASE_URL}>`, so
// under a non-root base (e.g. a `/pen-editor/` deploy) the editor route is
// reachable at "/pen-editor/app", not "/app". Strip that same base prefix
// before checking the route segment so this agrees with the router's own
// path matching regardless of deploy base; on this repo's actual deploy
// (render.com, base "/") the strip is a no-op.
export function isEditorPath(pathname: string): boolean {
  const base = import.meta.env.BASE_URL;
  const unprefixed =
    base !== "/" && pathname.startsWith(base) ? pathname.slice(base.length - 1) : pathname;
  // Segment match, not prefix match: a bare `startsWith("/app")` would also
  // claim a hypothetical "/appstore" route. Harmless today (AppRouter only
  // has an exact "/app"), but this same check gates whether a crash on the
  // editor route is allowed to auto-reload the page (see
  // recoverFromFatalError below), so a loose match here is a footgun worth
  // closing even before anything actually collides with it.
  return unprefixed === "/app" || unprefixed.startsWith("/app/");
}

// Activates a waiting service worker right away. Shared by the normal
// showcase auto-apply (registerServiceWorker's onNeedRefresh) and the crash
// recovery path below — both cases want the same "flip the flag, then send
// skipWaiting" sequence.
export function applyUpdateNow(): void {
  writeSessionFlag(AUTO_APPLY_KEY);
  // Sends SKIP_WAITING; vite-plugin-pwa reloads once the new worker takes
  // control. Nothing to await — the page goes away.
  void getUpdateSW()?.(true);

  // Fallback for when that reload never happens (activation hangs, or
  // getUpdateSW() was undefined — nothing registered yet). If the reload
  // does go through, the page navigates away before this fires and it's
  // moot; if it doesn't, autoApplyStalled flips PwaUpdateGate's toast on as
  // a last resort so the visitor isn't left with neither a silent update nor
  // a prompt for the rest of the session. 5s is comfortably longer than a
  // normal skipWaiting-to-reload turnaround.
  setTimeout(() => {
    usePwaStore.getState().setAutoApplyStalled(true);
  }, 5000);
}

// Reloads into a build that is already installed and controlling. This is
// the counterpart of applyUpdateNow for the self-activating worker
// (workbox skipWaiting/clientsClaim, see vite.config.ts): by the time the
// page hears about such an update there is nothing left to activate — the
// new worker already controls this client — so the only remaining step is a
// navigation. The session flag is written for the same reason applyUpdateNow
// writes it: if the reload lands on a page that *still* reports an update,
// the next load won't reload again and will show the prompt instead.
export function reloadForUpdate(): void {
  writeSessionFlag(AUTO_APPLY_KEY);
  window.location.reload();
}

// What the update prompt's button does. A waiting worker (a client still
// running a pre-skipWaiting build, or a browser that ignored skipWaiting)
// has to be told to activate first, and vite-plugin-pwa reloads for us once
// it takes control — the timer is only there in case that never lands.
// Otherwise the new worker is already in charge and a plain reload is the
// whole update.
export async function applyUpdateAndReload(): Promise<void> {
  let waiting = false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    waiting = reg?.waiting != null;
  } catch {
    // Treat an unreadable registration as "nothing waiting": a reload is
    // both the safe fallback and the common case.
  }
  if (waiting) {
    writeSessionFlag(AUTO_APPLY_KEY);
    void getUpdateSW()?.(true);
    setTimeout(() => window.location.reload(), 3000);
    return;
  }
  reloadForUpdate();
}

// Last-resort safety net for a fatal render crash (see the module comment).
// Fire-and-forget by design: callers (RootErrorBoundary, a top-level `error`
// listener) are themselves reacting to a broken tree and must not be made to
// wait on — or be able to throw from — the recovery attempt.
export function recoverFromFatalError(): void {
  if (readSessionFlag(CRASH_RECOVERED_KEY)) return;

  if (navigator.serviceWorker?.controller == null) {
    // Nothing is intercepting this load, so a stale/broken service-worker
    // cache isn't the cause — this is an ordinary app bug. Reloading would
    // just hit the same crash immediately, forever; leave it to the error
    // boundary's static fallback instead.
    return;
  }

  if (isEditorPath(window.location.pathname)) {
    // RootErrorBoundary is mounted above the router, so it covers "/app"
    // too — and a crash there is not necessarily a stale PWA bundle; it can
    // be an ordinary editor render bug with an unsaved document still in
    // memory. Auto-applying a waiting worker or unregistering + reloading
    // would discard that document with no confirmation, and would also
    // strip the editor's offline cache for a crash that had nothing to do
    // with the service worker. The showcase has nothing at stake, so it
    // keeps the automatic recovery; the editor pays a single manual click
    // (the boundary's "Reload" button) instead of a silent data loss.
    return;
  }

  // Burn the one-shot only now that a recovery is actually being attempted.
  // Setting it above the two early returns would let a bail-out spend the
  // session's single attempt: a crash on "/app" (or one with no controlling
  // worker) would leave a later crash on the showcase — the case this
  // recovery exists for — unable to try anything.
  writeSessionFlag(CRASH_RECOVERED_KEY);

  void (async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration?.waiting) {
        // A new version is already installed and waiting — this is exactly
        // the scenario the fix targets (stale controller serving a bundle
        // that crashes on the current API). Activate it; the new worker
        // takes control and reloads into the fixed build.
        applyUpdateNow();
        return;
      }
      // No newer version staged: the running worker itself is serving the
      // broken bundle from precache. Drop it and its caches so the reload
      // below is forced to fetch fresh instead of re-serving the same crash.
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((r) => r.unregister()));
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys.filter((key) => key.startsWith("workbox")).map((key) => caches.delete(key)),
      );
      location.reload();
    } catch {
      // Best-effort recovery; a swallowed error here just leaves the visitor
      // on the error boundary's static fallback instead of compounding the
      // crash with a second, unhandled one.
    }
  })();
}
