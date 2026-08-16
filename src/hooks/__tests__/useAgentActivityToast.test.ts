import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentActivityToast } from "@/hooks/useAgentActivityToast";

const toastMock = vi.fn();
vi.mock("sonner", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

// The cursor key deliberately kept its original "memoryActivityCursor"
// spelling when this hook grew skill support — see the hook's own comment.
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
    ({ status }) => useAgentActivityToast({ userId: "user-1", status }),
    { initialProps: { status: "streaming" } },
  );
}

describe("useAgentActivityToast", () => {
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

  it("writes a 0 cursor on baseline when the server has no rows yet, so the very next check is no longer treated as baseline (and a memory-only write on that next check still never toasts)", async () => {
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex <= 2) {
        // Turn 1's two checks: brand-new user, no audit rows exist yet
        // anywhere on the server.
        return jsonResponse({ events: [], latestId: null });
      }
      // Turn 2's first check: a review has now written the user's
      // first-ever row — a memory write, which never toasts (FIR-71).
      return jsonResponse({
        events: [{ id: 1, subsystem: "memory", origin: "background_review" }],
        latestId: 1,
      });
    });

    const { rerender } = renderStatus();
    rerender({ status: "ready" }); // turn 1: baseline, empty server
    await vi.advanceTimersByTimeAsync(60_000);

    expect(toastMock).not.toHaveBeenCalled();
    // Must be the string "0", not absent — an absent key is what would send
    // the hook back into the baseline branch on the next check.
    expect(localStorage.getItem(CURSOR_KEY)).toBe("0");

    rerender({ status: "streaming" });
    rerender({ status: "ready" }); // turn 2: first row ever written
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls[2][0] as string).toContain("sinceId=0");
    // The cursor still advances past a memory-only write even though it
    // produced no toast — bookkeeping is independent of announcement.
    expect(toastMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");
  });

  it("uses the stored cursor as sinceId once a baseline exists, and never toasts for a memory-only background_review event while still advancing the cursor", async () => {
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
    expect(toastMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURSOR_KEY)).toBe("11");

    // The follow-up check at 60s must still not toast.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("toasts a skill-specific message when only skill events are present", async () => {
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() =>
      jsonResponse({
        events: [
          { id: 11, subsystem: "skill", action: "create", origin: "background_review" },
        ],
        latestId: 11,
      }),
    );

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Агент обновил свои скиллы", {
      id: "memory-activity-11",
    });
  });

  it("toasts only the skills message (no 'память' wording) when both memory and skill events land in the same check", async () => {
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() =>
      jsonResponse({
        events: [
          { id: 11, subsystem: "memory", action: "write", origin: "background_review" },
          { id: 12, subsystem: "skill", action: "patch", origin: "background_review" },
        ],
        latestId: 12,
      }),
    );

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith("Агент обновил свои скиллы", {
      id: "memory-activity-12",
    });
  });

  it("treats an event with no subsystem field (older backend, pre-dates skills) as memory and never toasts for it", async () => {
    localStorage.setItem(CURSOR_KEY, "5");
    withFetch(() =>
      jsonResponse({
        events: [{ id: 6, origin: "background_review" }],
        latestId: 6,
      }),
    );

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).not.toHaveBeenCalled();
    expect(localStorage.getItem(CURSOR_KEY)).toBe("6");
  });

  it("catches a background review that only finishes after the first check, via the second (~60s) check", async () => {
    localStorage.setItem(CURSOR_KEY, "5");
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex === 1) {
        // Review is still running server-side when the first check fires.
        return jsonResponse({ events: [], latestId: 5 });
      }
      return jsonResponse({
        events: [{ id: 6, subsystem: "skill", origin: "background_review" }],
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

  it("does not toast for a non-background_review event even with a skill subsystem", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    withFetch(() =>
      jsonResponse({
        events: [{ id: 2, subsystem: "skill", origin: "foreground" }],
        latestId: 2,
      }),
    );

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(toastMock).not.toHaveBeenCalled();
  });

  it("persists the cursor across separate finished turns so a later turn's event is never lost, even though it's a memory write that never toasts", async () => {
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex <= 2) {
        // Turn 1's two checks: baseline, then nothing new.
        return jsonResponse({ events: [], latestId: 1 });
      }
      // Turn 2's first check: a background review landed since the cursor
      // (a memory write — no subsystem, the pre-phase-2 shape).
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
    // Cursor advances past the event even though it never toasts.
    expect(toastMock).not.toHaveBeenCalled();
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
      ({ status }) => useAgentActivityToast({ userId: undefined, status }),
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
