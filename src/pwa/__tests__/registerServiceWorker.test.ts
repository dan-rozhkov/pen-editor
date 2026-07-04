import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getUpdateSW, registerServiceWorker } from "@/pwa/registerServiceWorker";
import { registerSW } from "@/test/virtualPwaRegister";

describe("registerServiceWorker", () => {
  beforeEach(() => {
    registerSW.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not register when the browser has no serviceWorker support", () => {
    vi.stubGlobal("navigator", {});

    registerServiceWorker();

    expect(registerSW).not.toHaveBeenCalled();
  });

  it("registers the service worker and dispatches update/offline events", () => {
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

    const updateListener = vi.fn();
    const offlineListener = vi.fn();
    window.addEventListener("pen:pwa-update-ready", updateListener);
    window.addEventListener("pen:pwa-offline-ready", offlineListener);

    options.onNeedRefresh();
    options.onOfflineReady();

    expect(updateListener).toHaveBeenCalledTimes(1);
    expect(offlineListener).toHaveBeenCalledTimes(1);
    expect(getUpdateSW()).toBe(updateSWFn);

    window.removeEventListener("pen:pwa-update-ready", updateListener);
    window.removeEventListener("pen:pwa-offline-ready", offlineListener);
  });
});
