import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getUpdateSW, registerServiceWorker } from "@/pwa/registerServiceWorker";
import { registerSW } from "@/test/virtualPwaRegister";
import { usePwaStore } from "@/store/pwaStore";

describe("registerServiceWorker", () => {
  beforeEach(() => {
    registerSW.mockReset();
    usePwaStore.setState({ updateReady: false, offlineReady: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not register when the browser has no serviceWorker support", () => {
    vi.stubGlobal("navigator", {});

    registerServiceWorker();

    expect(registerSW).not.toHaveBeenCalled();
  });

  it("registers the service worker and updates pwaStore on refresh/offline-ready callbacks", () => {
    vi.stubGlobal("navigator", { serviceWorker: {} });
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
});
