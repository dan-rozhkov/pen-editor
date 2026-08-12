import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useMemoryActivityToast } from "@/hooks/useMemoryActivityToast";

const toastMock = vi.fn();
vi.mock("sonner", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

const CURSOR_KEY = "pen.memoryActivityCursor:user-1";

beforeEach(() => {
  vi.useFakeTimers();
  toastMock.mockReset();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// Default: no events, no known latestId (server has nothing for this user
// yet). Individual tests override with a scripted call sequence.
function withFetch(impl: (url: string, callIndex: number) => Promise<Response> | Response) {
  let callIndex = 0;
  const fetchMock = vi.fn((url: string) => {
    callIndex += 1;
    return Promise.resolve(impl(url, callIndex));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderStatus() {
  return renderHook(
    ({ status }) => useMemoryActivityToast({ userId: "user-1", status }),
    { initialProps: { status: "streaming" } },
  );
}

describe("useMemoryActivityToast", () => {
  it("establishes a baseline on the first-ever check (no stored cursor) and does not toast", async () => {
    const fetchMock = withFetch(() => jsonResponse({ events: [], latestId: 42 }));

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/memory/activity");
    expect(calledUrl).toContain("userId=user-1");
    expect(calledUrl).not.toContain("sinceId=");
    expect(toastMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURSOR_KEY)).toBe("42");
  });

  it("uses the stored cursor as sinceId once a baseline exists, and toasts exactly once on a background_review event", async () => {
    localStorage.setItem(CURSOR_KEY, "10");
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex === 1) {
        return jsonResponse({
          events: [
            { id: 11, subsystem: "memory", action: "write", origin: "background_review", created_at: "2026-08-11T00:00:00Z" },
          ],
          latestId: 11,
        });
      }
      // Second (60s) check: cursor has already advanced past this event.
      return jsonResponse({ events: [], latestId: 11 });
    });

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls[0][0] as string).toContain("sinceId=10");
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Агент обновил память о вас", {
      id: "memory-activity-11",
    });
    expect(localStorage.getItem(CURSOR_KEY)).toBe("11");

    // The follow-up check at 60s must not repeat the toast.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("catches a background review that only finishes after the first check, via the second (~60s) check", async () => {
    localStorage.setItem(CURSOR_KEY, "5");
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex === 1) {
        // Review is still running server-side when the first check fires.
        return jsonResponse({ events: [], latestId: 5 });
      }
      return jsonResponse({
        events: [{ id: 6, origin: "background_review" }],
        latestId: 6,
      });
    });

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);
    expect(toastMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toastMock).toHaveBeenCalledTimes(1);
    // Total requests per completed turn is capped at two.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not toast when no background_review events are present", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    withFetch(() => jsonResponse({ events: [], latestId: 1 }));

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("persists the cursor across separate finished turns so a later turn's event is never lost", async () => {
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex <= 2) {
        // Turn 1's two checks: baseline, then nothing new.
        return jsonResponse({ events: [], latestId: 1 });
      }
      // Turn 2's first check: a background review landed since the cursor.
      return jsonResponse({
        events: [{ id: 2, origin: "background_review" }],
        latestId: 2,
      });
    });

    const { rerender } = renderStatus();
    rerender({ status: "ready" }); // turn 1 finishes
    await vi.advanceTimersByTimeAsync(60_000);
    expect(toastMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");

    rerender({ status: "streaming" });
    rerender({ status: "ready" }); // turn 2 finishes
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls[2][0] as string).toContain("sinceId=1");
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("2");
  });

  it("silently ignores malformed JSON", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    withFetch(() => ({
      ok: true,
      json: () => Promise.reject(new Error("bad json")),
    }) as unknown as Response);

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("silently ignores a 404 from an older backend", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    withFetch(() => jsonResponse(null, false));

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("silently ignores a network error", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("does not schedule a check without a userId", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ events: [], latestId: null })));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(
      ({ status }) => useMemoryActivityToast({ userId: undefined, status }),
      { initialProps: { status: "streaming" } },
    );
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears pending checks when a new turn starts and finishes before the first delay elapses", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    const fetchMock = withFetch(() => jsonResponse({ events: [], latestId: 1 }));

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(10_000);
    rerender({ status: "streaming" });
    rerender({ status: "ready" });
    await vi.advanceTimersByTimeAsync(10_000);
    // Only 10s elapsed since the second "ready" — the first turn's timers
    // must have been cancelled, not fired.
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
