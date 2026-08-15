import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

// Module-mock pattern mirrors src/lib/__tests__/bridgeBootstrap.test.ts.
const { trackMock } = vi.hoisted(() => ({ trackMock: vi.fn() }));
vi.mock("@/lib/analytics", () => ({
  track: trackMock,
}));

import { markShowcaseAppLiked, useShowcaseLikes } from "@/lib/showcaseLikes";
import * as showcaseApi from "@/lib/showcase";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  trackMock.mockClear();
});

describe("useShowcaseLikes analytics", () => {
  it("fires showcase_liked once a genuine first like is confirmed by the server", async () => {
    vi.spyOn(showcaseApi, "likeShowcaseApp").mockResolvedValue({ ok: true, likes: 11 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));
    act(() => {
      result.current.like();
    });
    expect(trackMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(trackMock).toHaveBeenCalledTimes(1);
    expect(trackMock).toHaveBeenCalledWith("showcase_liked", { app_id: "run-1" });
  });

  it("does not fire on a failed like request (the optimistic count is rolled back)", async () => {
    vi.spyOn(showcaseApi, "likeShowcaseApp").mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));
    act(() => {
      result.current.like();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(trackMock).not.toHaveBeenCalled();
  });

  it("does not fire again for a burst of clicks within the same debounce window (collapses to one event)", async () => {
    const likeMock = vi
      .spyOn(showcaseApi, "likeShowcaseApp")
      .mockResolvedValue({ ok: true, likes: 13 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));
    act(() => {
      result.current.like();
      result.current.like();
      result.current.like();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(likeMock).toHaveBeenCalledTimes(1);
    expect(trackMock.mock.calls.filter(([event]) => event === "showcase_liked")).toHaveLength(1);
  });

  it("does not fire for a localStorage-guarded duplicate — an app already liked by this browser", async () => {
    // Simulate a returning visitor: this runId is already marked liked from a
    // previous session, before the hook even mounts.
    markShowcaseAppLiked("run-1");
    trackMock.mockClear();

    vi.spyOn(showcaseApi, "likeShowcaseApp").mockResolvedValue({ ok: true, likes: 12 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 11));
    act(() => {
      result.current.like();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    // The click still counts (optimistic increment + a real request), it's
    // just not this visitor's *first* like of this app, so no event.
    expect(result.current.count).toBe(12);
    expect(trackMock).not.toHaveBeenCalled();
  });

  it("fires showcase_liked at most once per mount even when localStorage is unavailable (Safari private mode)", async () => {
    // Simulate Safari private mode: both the read and the write throw, the
    // same way readLikedRunIds()/markShowcaseAppLiked() degrade in that
    // environment (see showcaseLikes.ts). Without gating on in-hook state,
    // hasLikedShowcaseApp() would report "not liked" forever and every
    // debounced burst in the visit would look like a genuine first like.
    const storageGetSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });
    const storageSetSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError: storage disabled");
    });

    vi.spyOn(showcaseApi, "likeShowcaseApp").mockResolvedValue({ ok: true, likes: 11 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));

    // Two separate debounced bursts within the same mount.
    act(() => {
      result.current.like();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    act(() => {
      result.current.like();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(trackMock.mock.calls.filter(([event]) => event === "showcase_liked")).toHaveLength(1);

    storageGetSpy.mockRestore();
    storageSetSpy.mockRestore();
  });
});
