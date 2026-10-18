import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentActivityNotes } from "@/hooks/useAgentActivityNotes";

import { useChatStore } from "@/store/chatStore";

const SESSION = "chat-1";
const getLastMessageId = () => "msg-last";

function notes() {
  return useChatStore.getState().activityNotes[SESSION] ?? [];
}

// The cursor key deliberately kept its original "memoryActivityCursor"
// spelling when this hook grew skill support — see the hook's own comment.
const CURSOR_KEY = "pen.memoryActivityCursor:user-1";

beforeEach(() => {
  vi.useFakeTimers();
  useChatStore.setState({ activityNotes: {} });
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
    ({ status }) => useAgentActivityNotes({ userId: "user-1", status, sessionId: SESSION, getLastMessageId }),
    { initialProps: { status: "streaming" } },
  );
}

describe("useAgentActivityNotes", () => {
  it("establishes a baseline on the first-ever check (no stored cursor) and does not note", async () => {
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
    expect(notes()).toEqual([]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("42");
  });

  it("writes a 0 cursor on baseline when the server has no rows yet, so the very next check is no longer treated as baseline (and a memory-only write on that next check still never notes)", async () => {
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex <= 2) {
        // Turn 1's two checks: brand-new user, no audit rows exist yet
        // anywhere on the server.
        return jsonResponse({ events: [], latestId: null });
      }
      // Turn 2's first check: a review has now written the user's
      // first-ever row — a memory write, which never notes (FIR-71).
      return jsonResponse({
        events: [{ id: 1, subsystem: "memory", origin: "background_review" }],
        latestId: 1,
      });
    });

    const { rerender } = renderStatus();
    rerender({ status: "ready" }); // turn 1: baseline, empty server
    await vi.advanceTimersByTimeAsync(60_000);

    expect(notes()).toEqual([]);
    // Must be the string "0", not absent — an absent key is what would send
    // the hook back into the baseline branch on the next check.
    expect(localStorage.getItem(CURSOR_KEY)).toBe("0");

    rerender({ status: "streaming" });
    rerender({ status: "ready" }); // turn 2: first row ever written
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls[2][0] as string).toContain("sinceId=0");
    // The cursor still advances past a memory-only write even though it
    // produced no note — bookkeeping is independent of announcement.
    expect(notes()).toEqual([]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");
  });

  it("uses the stored cursor as sinceId once a baseline exists, and never notes for a memory-only background_review event while still advancing the cursor", async () => {
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
    expect(notes()).toEqual([]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("11");

    // The follow-up check at 60s must still not note.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notes()).toEqual([]);
  });

  it("records a note when only skill events are present", async () => {
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

    expect(notes()).toEqual([{ id: "memory-activity-11", afterMessageId: "msg-last" }]);
  });

  it("anchors the note to the message that was last when the turn finished, not to one sent before the check fires", async () => {
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() =>
      jsonResponse({
        events: [{ id: 11, subsystem: "skill", action: "create", origin: "background_review" }],
        latestId: 11,
      }),
    );
    let lastId = "msg-turn-end";
    const { rerender } = renderHook(
      ({ status }) =>
        useAgentActivityNotes({ userId: "user-1", status, sessionId: SESSION, getLastMessageId: () => lastId }),
      { initialProps: { status: "streaming" } },
    );
    rerender({ status: "ready" });
    lastId = "msg-user-next";

    await vi.advanceTimersByTimeAsync(20_000);

    expect(notes()).toEqual([{ id: "memory-activity-11", afterMessageId: "msg-turn-end" }]);
  });

  it("records one note when both memory and skill events land in the same check", async () => {
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

    expect(notes()).toEqual([{ id: "memory-activity-12", afterMessageId: "msg-last" }]);
  });

  it("treats an event with no subsystem field (older backend, pre-dates skills) as memory and never notes for it", async () => {
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

    expect(notes()).toEqual([]);
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
    expect(notes()).toEqual([]);

    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notes()).toHaveLength(1);
    // Total requests per completed turn is capped at two.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("dedups by id when both checks of a turn observe the same skill event", async () => {
    localStorage.setItem(CURSOR_KEY, "10");
    const fetchMock = withFetch(() =>
      jsonResponse({
        events: [{ id: 11, subsystem: "skill", origin: "background_review" }],
        latestId: 11,
      }),
    );

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notes()).toHaveLength(1);
  });

  it("does not note when no background_review events are present", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    withFetch(() => jsonResponse({ events: [], latestId: 1 }));

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(60_000);

    expect(notes()).toEqual([]);
  });

  it("does not note for a non-background_review event even with a skill subsystem", async () => {
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

    expect(notes()).toEqual([]);
  });

  it("persists the cursor across separate finished turns so a later turn's event is never lost, even though it's a memory write that never notes", async () => {
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
    expect(notes()).toEqual([]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");

    rerender({ status: "streaming" });
    rerender({ status: "ready" }); // turn 2 finishes
    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock.mock.calls[2][0] as string).toContain("sinceId=1");
    // Cursor advances past the event even though it never notes.
    expect(notes()).toEqual([]);
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

    expect(notes()).toEqual([]);
  });

  it("silently ignores a 404 from an older backend", async () => {
    localStorage.setItem(CURSOR_KEY, "1");
    withFetch(() => jsonResponse(null, false));

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(notes()).toEqual([]);
  });

  it("silently ignores a network error", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new Error("offline")));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderStatus();
    rerender({ status: "ready" });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(notes()).toEqual([]);
  });

  it("does not schedule a check without a userId", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ events: [], latestId: null })));
    vi.stubGlobal("fetch", fetchMock);

    const { rerender } = renderHook(
      ({ status }) => useAgentActivityNotes({ userId: undefined, status, sessionId: SESSION, getLastMessageId }),
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

describe("useAgentActivityNotes with chatId/messageId on events", () => {
  const OTHER = "chat-other";

  function skillEvent(id: number, extra: Record<string, unknown> = {}) {
    return { id, subsystem: "skill", origin: "background_review", ...extra };
  }

  async function runCheck(events: unknown[], latestId: number) {
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() => jsonResponse({ events, latestId }));
    const { rerender } = renderStatus();
    rerender({ status: "ready" });
    await vi.advanceTimersByTimeAsync(20_000);
  }

  const turnNoteId = (chatId: string, messageId: string) =>
    `memory-activity-turn-${JSON.stringify([chatId, messageId])}`;

  function addChat(id: string) {
    const st = useChatStore.getState();
    useChatStore.setState({ chats: [...st.chats, { ...st.chats[0], id }] });
  }

  it("puts the note in the event's chat with turnMessageId, even if another chat scheduled the check", async () => {
    addChat(OTHER);
    await runCheck([skillEvent(11, { chatId: OTHER, messageId: "u1" })], 11);

    expect(notes()).toEqual([]);
    expect(useChatStore.getState().activityNotes[OTHER]).toEqual([
      { id: turnNoteId(OTHER, "u1"), turnMessageId: "u1" },
    ]);
  });

  it("skips an event whose chatId names no existing chat", async () => {
    await runCheck([skillEvent(11, { chatId: "ghost", messageId: "u1" })], 11);

    expect(useChatStore.getState().activityNotes).toEqual({});
    expect(localStorage.getItem(CURSOR_KEY)).toBe("11");
  });

  it("gives one note for two events of the same turn", async () => {
    addChat(OTHER);
    await runCheck(
      [
        skillEvent(12, { chatId: OTHER, messageId: "u1" }),
        skillEvent(11, { chatId: OTHER, messageId: "u1" }),
        skillEvent(13, { chatId: OTHER, messageId: "u2" }),
      ],
      13,
    );

    expect(useChatStore.getState().activityNotes[OTHER]).toEqual([
      { id: turnNoteId(OTHER, "u1"), turnMessageId: "u1" },
      { id: turnNoteId(OTHER, "u2"), turnMessageId: "u2" },
    ]);
  });

  it("keeps one note when the same turn's skills arrive in the 20s and the 60s checks", async () => {
    addChat(OTHER);
    let call = 0;
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() => {
      call += 1;
      return jsonResponse(
        call === 1
          ? { events: [skillEvent(11, { chatId: OTHER, messageId: "u1" })], latestId: 11 }
          : { events: [skillEvent(12, { chatId: OTHER, messageId: "u1" })], latestId: 12 },
      );
    });
    const { rerender } = renderStatus();
    rerender({ status: "ready" });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(call).toBe(2);
    expect(useChatStore.getState().activityNotes[OTHER]).toEqual([
      { id: turnNoteId(OTHER, "u1"), turnMessageId: "u1" },
    ]);
  });

  it("treats an event with an empty or non-string field as old-shape", async () => {
    await runCheck([skillEvent(11, { chatId: "", messageId: 5 })], 11);

    expect(notes()).toEqual([{ id: "memory-activity-11", afterMessageId: "msg-last" }]);
  });
});

describe("chatStore activity notes", () => {
  it("keeps one row for an event seen by two chats, and drops a chat's notes when it closes", () => {
    const store = useChatStore.getState();
    store.addActivityNote("chat-a", { id: "memory-activity-7", afterMessageId: "m1" });
    store.addActivityNote("chat-b", { id: "memory-activity-7", afterMessageId: "m2" });

    expect(useChatStore.getState().activityNotes).toEqual({
      "chat-a": [{ id: "memory-activity-7", afterMessageId: "m1" }],
    });

    useChatStore.setState({ chats: [...useChatStore.getState().chats, { ...useChatStore.getState().chats[0], id: "chat-a" }] });
    useChatStore.getState().closeChat("chat-a");

    expect(useChatStore.getState().activityNotes).toEqual({});
  });
});
