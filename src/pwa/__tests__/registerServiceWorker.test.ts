import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test resets the module registry so that updateSelfHeal's
// `autoApplyAlreadyTried` (read once at import time — see its module
// comment) reflects the sessionStorage state that test seeds. That means
// every module involved — the virtual:pwa-register stub, pwaStore, and
// registerServiceWorker itself — must be re-imported fresh *inside* each
// test rather than once at the top of the file; a top-level import would
// keep pointing at a stale instance the freshly-imported
// registerServiceWorker never touches.
async function freshModules() {
  vi.resetModules();
  const [{ registerSW }, { usePwaStore }, registerServiceWorkerModule] = await Promise.all([
    import("@/test/virtualPwaRegister"),
    import("@/store/pwaStore"),
    import("@/pwa/registerServiceWorker"),
  ]);
  return { registerSW, usePwaStore, ...registerServiceWorkerModule };
}

// happy-dom's own control surface lives on globalThis and isn't in this
// project's DOM lib types, so it needs the same narrow local cast
// fontStylesheets.test.ts uses. Not optional-chained on purpose: these tests
// assert route-dependent behavior, so a missing happyDOM must fail loudly
// rather than silently leave the URL at its default.
function setUrl(url: string) {
  (globalThis as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(url);
}

describe("registerServiceWorker", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("does not register when the browser has no serviceWorker support", async () => {
    vi.stubGlobal("navigator", {});
    const { registerSW, registerServiceWorker } = await freshModules();

    registerServiceWorker();

    expect(registerSW).not.toHaveBeenCalled();
  });

  it("registers the service worker and updates pwaStore on refresh/offline-ready callbacks", async () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    setUrl("http://localhost/app");
    const { registerSW, usePwaStore, registerServiceWorker, getUpdateSW } = await freshModules();
    const updateSWFn = vi.fn();
    registerSW.mockReturnValue(updateSWFn);

    registerServiceWorker();

    expect(registerSW).toHaveBeenCalledTimes(1);
    const options = registerSW.mock.calls[0][0] as {
      immediate: boolean;
      onNeedRefresh: () => void;
      onOfflineReady: () => void;
      onRegisterError: (error: unknown) => void;
    };
    expect(options.immediate).toBe(true);

    expect(usePwaStore.getState().updateReady).toBe(false);
    expect(usePwaStore.getState().offlineReady).toBe(false);

    options.onNeedRefresh();
    expect(usePwaStore.getState().updateReady).toBe(true);

    options.onOfflineReady();
    expect(usePwaStore.getState().offlineReady).toBe(true);

    expect(getUpdateSW()).toBe(updateSWFn);
  });

  // This is the fix: on the editor route, onNeedRefresh only surfaces the
  // prompt — it must never reload out from under an unsaved document.
  it("does not auto-apply the update on the editor route", async () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    setUrl("http://localhost/app");
    const { registerSW, registerServiceWorker } = await freshModules();
    const updateSWFn = vi.fn();
    registerSW.mockReturnValue(updateSWFn);

    registerServiceWorker();
    const options = registerSW.mock.calls[0][0] as { onNeedRefresh: () => void };
    options.onNeedRefresh();

    expect(updateSWFn).not.toHaveBeenCalled();
  });

  // The showcase holds no unsaved state, so onNeedRefresh applies the update
  // itself, right from this callback — no React component needs to mount for
  // this to happen (the whole point: a crashed render tree must not block it).
  it("auto-applies the update on the showcase route", async () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
    setUrl("http://localhost/");
    const { registerSW, registerServiceWorker } = await freshModules();
    const updateSWFn = vi.fn();
    registerSW.mockReturnValue(updateSWFn);

    registerServiceWorker();
    const options = registerSW.mock.calls[0][0] as { onNeedRefresh: () => void };
    options.onNeedRefresh();

    expect(updateSWFn).toHaveBeenCalledWith(true);
    expect(sessionStorage.getItem("pen.pwaAutoApplied")).toBe("1");
  });

  // Guard against a reload loop: if a previous auto-apply in this tab didn't
  // take (the update is still waiting on this very load), stop trying and
  // leave it to the toast fallback instead of reloading forever.
  it("does not auto-apply again on the showcase route once already tried this session", async () => {
    sessionStorage.setItem("pen.pwaAutoApplied", "1");
    vi.stubGlobal("navigator", { serviceWorker: {} });
    setUrl("http://localhost/");
    // autoApplyAlreadyTried is captured once at module import, from the
    // sessionStorage flag set above — freshModules() re-imports after that.
    const { registerSW, registerServiceWorker } = await freshModules();
    const updateSWFn = vi.fn();
    registerSW.mockReturnValue(updateSWFn);

    registerServiceWorker();
    const options = registerSW.mock.calls[0][0] as { onNeedRefresh: () => void };
    options.onNeedRefresh();

    expect(updateSWFn).not.toHaveBeenCalled();
  });
});
