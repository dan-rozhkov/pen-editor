import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  registerPendingImageLoad,
  hasPendingImageFillLoads,
  waitForPendingImageFills,
  __resetPendingImageLoadsForTests,
} from "../pendingImageLoads";

describe("pendingImageLoads", () => {
  beforeEach(() => {
    vi.useRealTimers();
    // Order-independence: a case that deliberately leaves a permanently-
    // pending promise in the module-level registry (see the last test below)
    // must not poison any test that runs after it.
    __resetPendingImageLoadsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when nothing is pending", async () => {
    expect(hasPendingImageFillLoads()).toBe(false);
    const start = Date.now();
    await waitForPendingImageFills(10_000);
    // Should not have waited on any timer.
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("waits for a pending load to settle before resolving", async () => {
    let resolveLoad: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveLoad = resolve;
    });
    registerPendingImageLoad(pending);
    expect(hasPendingImageFillLoads()).toBe(true);

    let waitSettled = false;
    const waitPromise = waitForPendingImageFills(10_000).then(() => {
      waitSettled = true;
    });

    // Give the event loop a couple of turns — the wait must NOT have settled yet.
    await Promise.resolve();
    await Promise.resolve();
    expect(waitSettled).toBe(false);

    resolveLoad();
    await waitPromise;
    expect(waitSettled).toBe(true);
    expect(hasPendingImageFillLoads()).toBe(false);
  });

  it("resolves when a pending load fails (rejects), not just on success", async () => {
    let rejectLoad: (err: Error) => void = () => {};
    const pending = new Promise<void>((_resolve, reject) => {
      rejectLoad = reject;
    });
    registerPendingImageLoad(pending);

    const waitPromise = waitForPendingImageFills(10_000);
    rejectLoad(new Error("network error"));

    await expect(waitPromise).resolves.toBeUndefined();
    expect(hasPendingImageFillLoads()).toBe(false);
  });

  it("picks up a load registered while already waiting, and waits for it too", async () => {
    let resolveFirst: () => void = () => {};
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    registerPendingImageLoad(first);

    const waitPromise = waitForPendingImageFills(10_000);

    // Register a second load "during" the wait, before the first settles.
    let resolveSecond: () => void = () => {};
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });
    registerPendingImageLoad(second);

    resolveFirst();
    // At this point only `first` has settled; `second` is still pending, so
    // the registry must still report a pending load.
    await Promise.resolve();
    await Promise.resolve();
    expect(hasPendingImageFillLoads()).toBe(true);

    resolveSecond();
    await waitPromise;
    expect(hasPendingImageFillLoads()).toBe(false);
  });

  // Deliberately leaves a permanently-unsettled promise in the module-level
  // registry (the whole point of the test) — order-independent now that
  // `beforeEach` resets the registry before every test, this one included.
  it("honours the timeout when a load never settles", async () => {
    const neverSettles = new Promise<void>(() => {});
    registerPendingImageLoad(neverSettles);

    const start = Date.now();
    await waitForPendingImageFills(50);
    const elapsed = Date.now() - start;

    // Never resolved by the load itself — the timeout must have fired.
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(1000);
    // The stale entry is still "pending" from the registry's point of view
    // (it never settled) — the important thing is the wait itself returned.
    expect(hasPendingImageFillLoads()).toBe(true);
  });

  // Finding #5 (2026-08-16 review): the deadline-race `setTimeout` must be
  // cleared once `Promise.all` wins, or every wait leaks a live timer.
  it("clears the deadline timer once the pending load settles before the timeout", async () => {
    vi.useFakeTimers();
    try {
      let resolveLoad: () => void = () => {};
      const pending = new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });
      registerPendingImageLoad(pending);

      const waitPromise = waitForPendingImageFills(10_000);
      resolveLoad();
      // Let the registration's `.then`/`.finally` microtasks and the
      // `Promise.race` settle before asserting on the timer queue.
      await vi.advanceTimersByTimeAsync(0);
      await waitPromise;

      // If the deadline `setTimeout` were left uncleared, it would still be
      // sitting in the fake-timer queue 10s later.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
