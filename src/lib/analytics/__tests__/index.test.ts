import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const initMock = vi.fn();
const captureMock = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: initMock,
    capture: captureMock,
  },
}));

vi.mock("@/lib/userId", () => ({
  getUserId: () => "test-user-id",
}));

async function flushMicrotasks() {
  // The dynamic `import("posthog-js")` inside initAnalytics() takes more
  // than a couple of microtask ticks to settle under Vitest's module
  // loader, even against the mocked module — poll with real timers instead
  // of guessing a fixed number of `Promise.resolve()` ticks.
  await vi.waitFor(() => {
    if (initMock.mock.calls.length === 0 && captureMock.mock.calls.length === 0) {
      throw new Error("dynamic import has not settled yet");
    }
  });
}

beforeEach(() => {
  initMock.mockReset();
  captureMock.mockReset();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("analytics — disabled (no key)", () => {
  it("track() is a no-op, isAnalyticsEnabled() is false, posthog-js is never imported", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", undefined);
    const { initAnalytics, track, isAnalyticsEnabled, __resetAnalyticsForTests } = await import(
      "../index"
    );
    __resetAnalyticsForTests();

    initAnalytics();
    track("editor_command_run", { command_id: "file-open" });
    // Nothing to poll for here — disabled means nothing is ever called.
    // Give any stray microtask a chance to run instead.
    await Promise.resolve();
    await Promise.resolve();

    expect(isAnalyticsEnabled()).toBe(false);
    expect(initMock).not.toHaveBeenCalled();
    expect(captureMock).not.toHaveBeenCalled();
  });
});

describe("analytics — enabled (key present)", () => {
  it("buffers events fired before init resolves, then flushes them in order", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    const { initAnalytics, track, isAnalyticsEnabled, __resetAnalyticsForTests } = await import(
      "../index"
    );
    __resetAnalyticsForTests();

    initAnalytics();
    // These fire synchronously, before the dynamic import of posthog-js has
    // resolved — they must be buffered, not dropped.
    track("editor_command_run", { command_id: "a" });
    track("editor_command_run", { command_id: "b" });
    track("editor_command_run", { command_id: "c" });

    await flushMicrotasks();

    expect(isAnalyticsEnabled()).toBe(true);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(initMock.mock.calls[0][0]).toBe("phc_test_key");
    expect(initMock.mock.calls[0][1]).toMatchObject({
      api_host: "https://us.i.posthog.com",
      person_profiles: "identified_only",
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: true,
      disable_session_recording: true,
      bootstrap: { distinctID: "test-user-id" },
    });

    const flushedIds = captureMock.mock.calls.map(([, props]) => props.command_id);
    expect(flushedIds).toEqual(["a", "b", "c"]);
  });

  it("drops the oldest buffered event once the cap is exceeded", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    const { initAnalytics, track, __resetAnalyticsForTests } = await import("../index");
    __resetAnalyticsForTests();

    // initAnalytics() enables buffering synchronously (state.enabled = true)
    // but the dynamic import of posthog-js hasn't resolved yet, so every
    // track() call in this synchronous block below is buffered, not sent.
    initAnalytics();
    for (let i = 0; i < 55; i++) {
      track("editor_command_run", { command_id: `cmd-${i}` });
    }
    await flushMicrotasks();

    const flushedIds = captureMock.mock.calls.map(([, props]) => props.command_id);
    expect(flushedIds).toHaveLength(50);
    // The oldest 5 (cmd-0..cmd-4) were dropped; the most recent 50 survive.
    expect(flushedIds[0]).toBe("cmd-5");
    expect(flushedIds[flushedIds.length - 1]).toBe("cmd-54");
  });

  it("swallows an error from a throwing client", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    captureMock.mockImplementation(() => {
      throw new Error("client boom");
    });
    const { initAnalytics, track, __resetAnalyticsForTests } = await import("../index");
    __resetAnalyticsForTests();

    initAnalytics();
    await flushMicrotasks();

    expect(() => track("editor_command_run", { command_id: "x" })).not.toThrow();
  });

  it("one throwing buffered event does not disable analytics for the rest of the page's life", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    // First buffered event throws; the rest of that same flush, and every
    // later track(), must still go through — a client that loaded fine must
    // not get permanently marked as failed over one bad event.
    captureMock.mockImplementationOnce(() => {
      throw new Error("boom on first buffered event");
    });
    const { initAnalytics, track, isAnalyticsEnabled, __resetAnalyticsForTests } = await import(
      "../index"
    );
    __resetAnalyticsForTests();

    initAnalytics();
    track("editor_command_run", { command_id: "a" });
    track("editor_command_run", { command_id: "b" });

    await flushMicrotasks();

    // The loader itself succeeded — this must not have been reclassified as
    // a load failure.
    expect(isAnalyticsEnabled()).toBe(true);
    expect(captureMock).toHaveBeenCalledTimes(2);
    const flushedIds = captureMock.mock.calls.map(([, props]) => props.command_id);
    expect(flushedIds).toEqual(["a", "b"]);

    // A track() fired after the client is live must go straight through,
    // not silently no-op.
    captureMock.mockClear();
    track("editor_command_run", { command_id: "c" });
    expect(captureMock).toHaveBeenCalledWith(
      "editor_command_run",
      expect.objectContaining({ command_id: "c" }),
    );
  });
});

describe("capturePageview", () => {
  it("sends an absolute URL ($current_url = origin + pathname), not a bare pathname", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    const { initAnalytics, capturePageview, __resetAnalyticsForTests } = await import("../index");
    __resetAnalyticsForTests();

    initAnalytics();
    await flushMicrotasks();
    captureMock.mockClear();

    capturePageview("/app");

    expect(captureMock).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/app`,
    });
  });

  it("buffers a pageview fired before the client is ready and flushes it with an absolute URL", async () => {
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test_key");
    const { initAnalytics, capturePageview, __resetAnalyticsForTests } = await import("../index");
    __resetAnalyticsForTests();

    initAnalytics();
    capturePageview("/app");
    await flushMicrotasks();

    expect(captureMock).toHaveBeenCalledWith("$pageview", {
      $current_url: `${window.location.origin}/app`,
    });
  });
});

describe("bucketLength", () => {
  it("buckets boundaries correctly", async () => {
    const { bucketLength } = await import("../buckets");
    expect(bucketLength(0)).toBe("0-50");
    expect(bucketLength(50)).toBe("0-50");
    expect(bucketLength(51)).toBe("50-200");
    expect(bucketLength(200)).toBe("50-200");
    expect(bucketLength(201)).toBe("200-1000");
    expect(bucketLength(1000)).toBe("200-1000");
    expect(bucketLength(1001)).toBe("1000+");
  });
});
