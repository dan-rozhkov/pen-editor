import { beforeEach, describe, expect, it, vi } from "vitest";

import { BROWSE_TRACES_KEY, setTracesForAllRuns, subscribeTracesForAllRuns, tracesForAllRuns } from "../browseTracePref";

beforeEach(() => localStorage.clear());

describe("browseTracePref", () => {
  it("defaults to QA runs only", () => {
    expect(tracesForAllRuns()).toBe(false);
  });

  it("set writes 'all' and clearing removes the key", () => {
    setTracesForAllRuns(true);
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBe("all");
    expect(tracesForAllRuns()).toBe(true);
    setTracesForAllRuns(false);
    expect(localStorage.getItem(BROWSE_TRACES_KEY)).toBeNull();
    expect(tracesForAllRuns()).toBe(false);
  });

  it("notifies subscribers on a local set and on a storage event from another document", () => {
    const cb = vi.fn();
    const off = subscribeTracesForAllRuns(cb);
    setTracesForAllRuns(true);
    expect(cb).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: BROWSE_TRACES_KEY, newValue: null, storageArea: localStorage }));
    expect(cb).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "x", storageArea: localStorage }));
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setTracesForAllRuns(false);
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
