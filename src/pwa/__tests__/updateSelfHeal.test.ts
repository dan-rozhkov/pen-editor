import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// autoApplyAlreadyTried is read once at module import time (that's the whole
// point — see updateSelfHeal.ts's module comment), so every test that cares
// about its value must reset the module registry and re-import fresh with
// sessionStorage seeded beforehand. A plain re-render/re-call can't flip it.
async function freshImport() {
  vi.resetModules();
  return import("@/pwa/updateSelfHeal");
}

describe("updateSelfHeal", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("isEditorPath", () => {
    it("treats /app and its subpaths as the editor", async () => {
      const { isEditorPath } = await freshImport();
      expect(isEditorPath("/app")).toBe(true);
      expect(isEditorPath("/app/")).toBe(true);
    });

    it("treats the showcase and any other path as non-editor", async () => {
      const { isEditorPath } = await freshImport();
      expect(isEditorPath("/")).toBe(false);
      expect(isEditorPath("/foo")).toBe(false);
    });

    it("does not treat a path merely prefixed with /app (e.g. /appstore) as the editor", async () => {
      const { isEditorPath } = await freshImport();
      expect(isEditorPath("/appstore")).toBe(false);
    });

    it("strips a non-root BASE_URL before matching the /app segment", async () => {
      vi.stubEnv("BASE_URL", "/pen-editor/");
      const { isEditorPath } = await freshImport();
      expect(isEditorPath("/pen-editor/app")).toBe(true);
      expect(isEditorPath("/pen-editor/app/settings")).toBe(true);
      expect(isEditorPath("/pen-editor/")).toBe(false);
      expect(isEditorPath("/pen-editor/appstore")).toBe(false);
    });
  });

  describe("autoApplyAlreadyTried", () => {
    it("is false on a clean session, and does not leave the flag set", async () => {
      const mod = await freshImport();
      expect(mod.autoApplyAlreadyTried).toBe(false);
      expect(sessionStorage.getItem(mod.AUTO_APPLY_KEY)).toBeNull();
    });

    it("is true when the flag was already set, and clears it (one-shot read)", async () => {
      sessionStorage.setItem("pen.pwaAutoApplied", "1");
      const mod = await freshImport();
      expect(mod.autoApplyAlreadyTried).toBe(true);
      // Cleared immediately: a successful auto-apply reloads into a build
      // with nothing waiting, so the next module load must start clean.
      expect(sessionStorage.getItem(mod.AUTO_APPLY_KEY)).toBeNull();
    });

    it("does not throw when sessionStorage is unavailable (Safari private mode)", async () => {
      vi.resetModules();
      const original = window.sessionStorage;
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new Error("sessionStorage disabled");
        },
      });
      try {
        const mod = await import("@/pwa/updateSelfHeal");
        expect(mod.autoApplyAlreadyTried).toBe(false);
      } finally {
        Object.defineProperty(window, "sessionStorage", {
          configurable: true,
          value: original,
        });
      }
    });
  });

  describe("applyUpdateNow", () => {
    it("marks the session flag and invokes the registered update function", async () => {
      const { applyUpdateNow, setUpdateSW, AUTO_APPLY_KEY } = await freshImport();
      const updateSW = vi.fn();
      setUpdateSW(updateSW);

      applyUpdateNow();

      expect(sessionStorage.getItem(AUTO_APPLY_KEY)).toBe("1");
      expect(updateSW).toHaveBeenCalledWith(true);
    });

    it("does not throw when no update function has been registered yet", async () => {
      const { applyUpdateNow } = await freshImport();
      expect(() => applyUpdateNow()).not.toThrow();
    });

    // Finding: autoApplyAlreadyTried is a session flag read once at module
    // init, so if the update it triggers never reaches a reload (activation
    // hangs, or getUpdateSW() was undefined), the showcase toast has no way
    // to flip on for the rest of the session. applyUpdateNow's own stall
    // timer is the fallback signal — see PwaUpdateGate's autoApplyStalled.
    it("flips autoApplyStalled 5s after applying, when the page hasn't reloaded", async () => {
      vi.useFakeTimers();
      try {
        // vi.resetModules() (inside freshImport) would also hand this test a
        // second, disconnected pwaStore instance if it re-imported the
        // top-of-file `usePwaStore` — re-import it here too so assertions
        // read the same store instance updateSelfHeal.ts's fresh copy writes
        // to (see the equivalent note in PwaUpdateGate.test.tsx).
        const { applyUpdateNow } = await freshImport();
        const { usePwaStore: freshPwaStore } = await import("@/store/pwaStore");
        freshPwaStore.setState({ autoApplyStalled: false });

        applyUpdateNow();
        expect(freshPwaStore.getState().autoApplyStalled).toBe(false);

        vi.advanceTimersByTime(5000);
        expect(freshPwaStore.getState().autoApplyStalled).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("recoverFromFatalError", () => {
    it("does nothing when the page has no controlling service worker", async () => {
      const { recoverFromFatalError } = await freshImport();
      vi.stubGlobal("navigator", { serviceWorker: { controller: null } });

      recoverFromFatalError();
      await Promise.resolve();

      // Nothing to assert on directly beyond "did not throw" — there is no
      // registration to query in this branch, which is the point: it bails
      // before touching the service worker at all.
    });

    it("activates a waiting worker instead of reloading, when one is staged", async () => {
      const { recoverFromFatalError, setUpdateSW, AUTO_APPLY_KEY } = await freshImport();
      const updateSW = vi.fn();
      setUpdateSW(updateSW);
      const getRegistration = vi.fn().mockResolvedValue({ waiting: {} });
      vi.stubGlobal("navigator", {
        serviceWorker: { controller: {}, getRegistration },
      });

      recoverFromFatalError();
      await vi.waitFor(() => expect(updateSW).toHaveBeenCalledWith(true));

      expect(sessionStorage.getItem(AUTO_APPLY_KEY)).toBe("1");
    });

    it("unregisters the worker, clears workbox caches, and reloads when nothing is waiting", async () => {
      const { recoverFromFatalError } = await freshImport();
      const unregister = vi.fn().mockResolvedValue(true);
      const getRegistration = vi.fn().mockResolvedValue({ waiting: null });
      const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
      const reload = vi.fn();
      const cachesDelete = vi.fn().mockResolvedValue(true);
      vi.stubGlobal("navigator", {
        serviceWorker: { controller: {}, getRegistration, getRegistrations },
      });
      vi.stubGlobal("caches", {
        keys: vi.fn().mockResolvedValue(["workbox-precache-v1", "some-other-cache"]),
        delete: cachesDelete,
      });
      // pathname: "/" — the showcase route, where automatic recovery is
      // allowed (see the "/app" tests below for the gated branch).
      vi.stubGlobal("location", { reload, pathname: "/" });

      recoverFromFatalError();
      await vi.waitFor(() => expect(reload).toHaveBeenCalled());

      expect(unregister).toHaveBeenCalled();
      expect(cachesDelete).toHaveBeenCalledWith("workbox-precache-v1");
      expect(cachesDelete).not.toHaveBeenCalledWith("some-other-cache");
    });

    it("only runs once per session even if called again", async () => {
      const { recoverFromFatalError } = await freshImport();
      const getRegistration = vi.fn().mockResolvedValue({ waiting: null });
      const getRegistrations = vi.fn().mockResolvedValue([]);
      vi.stubGlobal("navigator", {
        serviceWorker: { controller: {}, getRegistration, getRegistrations },
      });
      vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue([]) });
      vi.stubGlobal("location", { reload: vi.fn(), pathname: "/" });

      recoverFromFatalError();
      await Promise.resolve();
      recoverFromFatalError();
      await Promise.resolve();

      expect(getRegistration).toHaveBeenCalledTimes(1);
    });

    // Finding: a fatal render crash on the editor route must never be
    // auto-recovered — the editor may hold an unsaved document, and
    // RootErrorBoundary sits above the router so it catches crashes there
    // too. Automatic recovery stays exclusive to the showcase; the editor's
    // visitor keeps the boundary's manual "Reload" button instead.
    it("does not activate a waiting worker when the crash is on the editor route", async () => {
      const { recoverFromFatalError, setUpdateSW, AUTO_APPLY_KEY } = await freshImport();
      const updateSW = vi.fn();
      setUpdateSW(updateSW);
      const getRegistration = vi.fn().mockResolvedValue({ waiting: {} });
      vi.stubGlobal("navigator", {
        serviceWorker: { controller: {}, getRegistration },
      });
      vi.stubGlobal("location", { reload: vi.fn(), pathname: "/app" });

      recoverFromFatalError();
      await Promise.resolve();
      await Promise.resolve();

      expect(getRegistration).not.toHaveBeenCalled();
      expect(updateSW).not.toHaveBeenCalled();
      expect(sessionStorage.getItem(AUTO_APPLY_KEY)).toBeNull();
    });

    it("does not unregister the worker or reload when the crash is on the editor route", async () => {
      const { recoverFromFatalError } = await freshImport();
      const getRegistration = vi.fn().mockResolvedValue({ waiting: null });
      const getRegistrations = vi.fn().mockResolvedValue([]);
      const reload = vi.fn();
      vi.stubGlobal("navigator", {
        serviceWorker: { controller: {}, getRegistration, getRegistrations },
      });
      vi.stubGlobal("caches", { keys: vi.fn().mockResolvedValue([]) });
      vi.stubGlobal("location", { reload, pathname: "/app/settings" });

      recoverFromFatalError();
      await Promise.resolve();
      await Promise.resolve();

      expect(getRegistration).not.toHaveBeenCalled();
      expect(getRegistrations).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    });
  });
  // The update prompt's button. Since the worker activates itself now
  // (vite.config.ts's skipWaiting/clientsClaim), "apply the update" is
  // usually just a navigation — the old message-the-worker-and-wait path
  // only still exists for a client that predates that config.
  describe("applyUpdateAndReload", () => {
    it("reloads straight away when no worker is waiting", async () => {
      const { applyUpdateAndReload } = await freshImport();
      const reload = vi.fn();
      vi.stubGlobal("navigator", {
        serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ waiting: null }) },
      });
      vi.stubGlobal("location", { reload, pathname: "/app" });

      await applyUpdateAndReload();

      expect(reload).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("pen.pwaAutoApplied")).toBe("1");
    });

    it("messages a waiting worker first, and still reloads if that never lands", async () => {
      vi.useFakeTimers();
      const { applyUpdateAndReload, setUpdateSW } = await freshImport();
      const updateSW = vi.fn().mockResolvedValue(undefined);
      setUpdateSW(updateSW);
      const reload = vi.fn();
      vi.stubGlobal("navigator", {
        serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ waiting: {} }) },
      });
      vi.stubGlobal("location", { reload, pathname: "/app" });

      await applyUpdateAndReload();

      expect(updateSW).toHaveBeenCalledWith(true);
      // vite-plugin-pwa reloads on its own once the new worker takes control;
      // this timer is the fallback for when it doesn't.
      expect(reload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(reload).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("reloads even when the registration can't be read", async () => {
      const { applyUpdateAndReload } = await freshImport();
      const reload = vi.fn();
      vi.stubGlobal("navigator", {
        serviceWorker: { getRegistration: vi.fn().mockRejectedValue(new Error("nope")) },
      });
      vi.stubGlobal("location", { reload, pathname: "/app" });

      await applyUpdateAndReload();

      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
