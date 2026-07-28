import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

import {
  chunkLikeDelta,
  hasLikedShowcaseApp,
  markShowcaseAppLiked,
  useShowcaseLikes,
} from "@/lib/showcaseLikes";
import * as showcaseApi from "@/lib/showcase";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

describe("chunkLikeDelta", () => {
  it("returns a single chunk for a delta within the per-request bound", () => {
    expect(chunkLikeDelta(1)).toEqual([1]);
    expect(chunkLikeDelta(25)).toEqual([25]);
  });

  it("splits a larger delta into multiple bounded chunks, in order, losing nothing", () => {
    expect(chunkLikeDelta(30)).toEqual([25, 5]);
    expect(chunkLikeDelta(51)).toEqual([25, 25, 1]);
  });

  it("returns an empty list for a zero or negative delta", () => {
    expect(chunkLikeDelta(0)).toEqual([]);
    expect(chunkLikeDelta(-3)).toEqual([]);
  });
});

describe("hasLikedShowcaseApp / markShowcaseAppLiked", () => {
  it("is false until the app is marked, and persists across reads", () => {
    expect(hasLikedShowcaseApp("run-1")).toBe(false);
    markShowcaseAppLiked("run-1");
    expect(hasLikedShowcaseApp("run-1")).toBe(true);
    expect(hasLikedShowcaseApp("run-2")).toBe(false);
  });

  it("degrades to false/no-op when localStorage throws (e.g. Safari private mode)", () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const setSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(() => hasLikedShowcaseApp("run-1")).not.toThrow();
    expect(hasLikedShowcaseApp("run-1")).toBe(false);
    expect(() => markShowcaseAppLiked("run-1")).not.toThrow();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe("useShowcaseLikes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("increments the displayed count immediately on click, before any request resolves", () => {
    vi.spyOn(showcaseApi, "likeShowcaseApp").mockReturnValue(
      new Promise(() => {}), // never resolves
    );

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));
    expect(result.current.count).toBe(10);

    act(() => {
      result.current.like();
    });

    expect(result.current.count).toBe(11);
    expect(result.current.liked).toBe(true);
  });

  it("sends one debounced request with the accumulated delta for a burst of clicks", async () => {
    const likeMock = vi
      .spyOn(showcaseApi, "likeShowcaseApp")
      .mockResolvedValue({ ok: true, likes: 13 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));

    act(() => {
      result.current.like();
      result.current.like();
      result.current.like();
    });
    expect(result.current.count).toBe(13);
    expect(likeMock).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(likeMock).toHaveBeenCalledTimes(1);
    expect(likeMock).toHaveBeenCalledWith("run-1", 3);
  });

  it("rolls back only the unconfirmed delta when the request fails", async () => {
    vi.spyOn(showcaseApi, "likeShowcaseApp").mockResolvedValue({ ok: false });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));

    act(() => {
      result.current.like();
      result.current.like();
    });
    expect(result.current.count).toBe(12);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(result.current.count).toBe(10);
  });

  it("does not roll back a delta from an earlier, already-confirmed burst", async () => {
    const likeMock = vi.spyOn(showcaseApi, "likeShowcaseApp");
    likeMock.mockResolvedValueOnce({ ok: true, likes: 11 });
    likeMock.mockResolvedValueOnce({ ok: false });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));

    act(() => {
      result.current.like();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(result.current.count).toBe(11);

    act(() => {
      result.current.like();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    // Only the second (failed) click's delta is rolled back — the first
    // click's confirmed +1 stays counted.
    expect(result.current.count).toBe(11);
  });

  it("flushes the pending delta on unmount instead of dropping it", async () => {
    const likeMock = vi
      .spyOn(showcaseApi, "likeShowcaseApp")
      .mockResolvedValue({ ok: true, likes: 11 });

    const { result, unmount } = renderHook(() => useShowcaseLikes("run-1", 10));

    act(() => {
      result.current.like();
    });
    expect(likeMock).not.toHaveBeenCalled();

    unmount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(likeMock).toHaveBeenCalledTimes(1);
    expect(likeMock).toHaveBeenCalledWith("run-1", 1);
  });

  it("splits a burst over 25 into multiple sequential requests on the real flush path, losing and duplicating nothing", async () => {
    // Regression coverage for the boot path, not just the pure helper:
    // `chunkLikeDelta` was unit-tested but unused by `flush` at review time —
    // this drives an actual >25 burst through `useShowcaseLikes` and checks
    // the requests that go out, not just what the standalone function returns.
    const likeMock = vi.spyOn(showcaseApi, "likeShowcaseApp");
    likeMock.mockResolvedValueOnce({ ok: true, likes: 25 });
    likeMock.mockResolvedValueOnce({ ok: true, likes: 30 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 0));

    act(() => {
      for (let i = 0; i < 30; i++) result.current.like();
    });
    expect(result.current.count).toBe(30);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(likeMock).toHaveBeenCalledTimes(2);
    expect(likeMock).toHaveBeenNthCalledWith(1, "run-1", 25);
    expect(likeMock).toHaveBeenNthCalledWith(2, "run-1", 5);
    // Nothing lost, nothing double-counted — and the final count snaps to the
    // server's own authoritative total for the burst.
    expect(result.current.count).toBe(30);
  });

  it("picks up a click that lands mid-flight instead of waiting for a whole new debounce cycle", async () => {
    const likeMock = vi.spyOn(showcaseApi, "likeShowcaseApp");
    let resolveFirst: ((result: { ok: true; likes: number }) => void) | null = null;
    likeMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    likeMock.mockResolvedValueOnce({ ok: true, likes: 12 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));

    act(() => {
      result.current.like();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });
    expect(likeMock).toHaveBeenCalledTimes(1);

    // A second click arrives while the first request is still in flight —
    // it must be picked up by the still-running flush loop, not stranded
    // until another 700ms debounce.
    act(() => {
      result.current.like();
    });
    expect(result.current.count).toBe(12);

    await act(async () => {
      resolveFirst?.({ ok: true, likes: 11 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(likeMock).toHaveBeenCalledTimes(2);
    expect(likeMock).toHaveBeenNthCalledWith(2, "run-1", 1);
    expect(result.current.count).toBe(12);
  });

  it("snaps the count up to the server's authoritative total once a flush fully lands (someone else liked it too)", async () => {
    // The server's `likes` in the response is ground truth; the client's
    // running total is just an optimistic guess. If another visitor's like
    // landed in between, the response total is higher than what this tab
    // computed on its own — and that must win once nothing is left unsent.
    vi.spyOn(showcaseApi, "likeShowcaseApp").mockResolvedValue({ ok: true, likes: 50 });

    const { result } = renderHook(() => useShowcaseLikes("run-1", 10));

    act(() => {
      result.current.like();
    });
    expect(result.current.count).toBe(11);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(result.current.count).toBe(50);
  });

  it("flushes the pending delta when the tab is hidden", async () => {
    const likeMock = vi
      .spyOn(showcaseApi, "likeShowcaseApp")
      .mockResolvedValue({ ok: true, likes: 11 });

    const { result } = renderHook(() => useShowcaseLikes("run-2", 5));
    act(() => {
      result.current.like();
    });
    expect(likeMock).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(likeMock).toHaveBeenCalledWith("run-2", 1);
  });
});
