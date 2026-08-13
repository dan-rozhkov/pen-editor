import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePwaStore } from "@/store/pwaStore";
import { checkForUpdate } from "@/pwa/checkForUpdate";

function resetPwaStore() {
  usePwaStore.setState({
    updateReady: false,
    offlineReady: false,
    toastSuppressed: true,
    autoApplyStalled: false,
  });
}

describe("checkForUpdate", () => {
  beforeEach(() => {
    resetPwaStore();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("returns unsupported when the browser has no serviceWorker support", async () => {
    vi.stubGlobal("navigator", {});

    await expect(checkForUpdate()).resolves.toBe("unsupported");
  });

  it("returns unsupported when there is no registration", async () => {
    const getRegistration = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    await expect(checkForUpdate()).resolves.toBe("unsupported");
  });

  it("returns update-found and sets store flags when update() resolves with a waiting worker", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const getRegistration = vi.fn().mockResolvedValue({
      update,
      waiting: {},
      installing: null,
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    await expect(checkForUpdate()).resolves.toBe("update-found");

    expect(update).toHaveBeenCalled();
    expect(usePwaStore.getState().updateReady).toBe(true);
    // Suppression belongs to present mode — a manual check must not lift it.
    expect(usePwaStore.getState().toastSuppressed).toBe(true);
  });

  it("returns up-to-date when there is neither an installing nor a waiting worker", async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const getRegistration = vi.fn().mockResolvedValue({
      update,
      waiting: null,
      installing: null,
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    await expect(checkForUpdate()).resolves.toBe("up-to-date");
    expect(usePwaStore.getState().updateReady).toBe(false);
  });

  it("returns update-found when an installing worker transitions to installed and leaves a waiting worker", async () => {
    let stateChangeHandler: (() => void) | undefined;
    const installingWorker = {
      state: "installing",
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        stateChangeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    const reg = {
      update: vi.fn().mockResolvedValue(undefined),
      waiting: null as unknown,
      installing: installingWorker,
    };
    const getRegistration = vi.fn().mockResolvedValue(reg);
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });

    const promise = checkForUpdate();

    // Simulate the browser installing the new worker and then exposing it
    // as `waiting`, the same way a real registration would.
    await Promise.resolve();
    await Promise.resolve();
    installingWorker.state = "installed";
    reg.waiting = {};
    stateChangeHandler?.();

    await expect(promise).resolves.toBe("update-found");
    expect(usePwaStore.getState().updateReady).toBe(true);
  });

  it("returns error when the installing worker goes redundant (failed install)", async () => {
    let stateChangeHandler: (() => void) | undefined;
    const installingWorker = {
      state: "installing",
      addEventListener: vi.fn((_event: string, handler: () => void) => {
        stateChangeHandler = handler;
      }),
      removeEventListener: vi.fn(),
    };
    const reg = {
      update: vi.fn().mockResolvedValue(undefined),
      waiting: null as unknown,
      installing: installingWorker,
    };
    vi.stubGlobal("navigator", {
      serviceWorker: { getRegistration: vi.fn().mockResolvedValue(reg) },
    });

    const promise = checkForUpdate();
    await Promise.resolve();
    await Promise.resolve();
    installingWorker.state = "redundant";
    stateChangeHandler?.();

    await expect(promise).resolves.toBe("error");
    expect(usePwaStore.getState().updateReady).toBe(false);
  });

  it("settles immediately when the new worker already moved past installing", async () => {
    // A skipWaiting worker reaches "activating"/"activated" and never fires
    // another statechange — waiting for one would stall the whole timeout.
    const installingWorker = {
      state: "activated",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("navigator", {
      serviceWorker: {
        getRegistration: vi.fn().mockResolvedValue({
          update: vi.fn().mockResolvedValue(undefined),
          waiting: null,
          installing: installingWorker,
        }),
      },
    });

    // The self-activating worker (skipWaiting) never parks in `waiting`, so
    // "installed successfully, nothing waiting" is the *normal* shape of a
    // found update — reporting "you're on the latest version" here is what
    // made a manual check useless on a stuck client.
    await expect(checkForUpdate()).resolves.toBe("update-found");
    expect(usePwaStore.getState().updateReady).toBe(true);
    expect(installingWorker.addEventListener).not.toHaveBeenCalled();
  });

  it("returns error and does not throw when update() rejects", async () => {
    const update = vi.fn().mockRejectedValue(new Error("network error"));
    const getRegistration = vi.fn().mockResolvedValue({
      update,
      waiting: null,
      installing: null,
    });
    vi.stubGlobal("navigator", { serviceWorker: { getRegistration } });
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(checkForUpdate()).resolves.toBe("error");
  });
});
