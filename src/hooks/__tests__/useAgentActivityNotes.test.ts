import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAgentActivityNotes } from "@/hooks/useAgentActivityNotes";

import { useChatStore } from "@/store/chatStore";
import { formatChange, noteChangeList } from "@/lib/memoryActivity";

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

  it("writes a 0 cursor on baseline when the server has no rows yet, so the very next check is no longer treated as baseline (and a memory-only write on that next check now notes)", async () => {
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex <= 2) {
        // Turn 1's two checks: brand-new user, no audit rows exist yet
        // anywhere on the server.
        return jsonResponse({ events: [], latestId: null });
      }
      // Turn 2's first check: a review has now written the user's
      // first-ever row — a memory write.
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
    expect(notes()).toEqual([{ id: "memory-activity-1", afterMessageId: "msg-last", changesByEvent: {"1": []} }]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("1");
  });

  it("uses the stored cursor as sinceId once a baseline exists, and notes a memory-only background_review event with its change", async () => {
    localStorage.setItem(CURSOR_KEY, "10");
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex === 1) {
        return jsonResponse({
          events: [
            {
              id: 11,
              subsystem: "memory",
              action: "write",
              origin: "background_review",
              created_at: "2026-08-11T00:00:00Z",
              detail: { kind: "memory", target: "user", operations: [{ action: "add", content: "likes teal" }] },
            },
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
    const change = { kind: "memory", target: "user", action: "add", content: "likes teal" };
    expect(notes()).toMatchObject([{ id: "memory-activity-11", changesByEvent: { "11": [expect.objectContaining(change)] } }]);
    expect(localStorage.getItem(CURSOR_KEY)).toBe("11");

    // The follow-up check at 60s sees nothing new and changes nothing.
    await vi.advanceTimersByTimeAsync(40_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(notes()).toHaveLength(1);
    expect(noteChangeList(notes()[0].changesByEvent)).toHaveLength(1);
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

    expect(notes()).toEqual([{ id: "memory-activity-11", afterMessageId: "msg-last", changesByEvent: {"11": []} }]);
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

    expect(notes()).toEqual([{ id: "memory-activity-11", afterMessageId: "msg-turn-end", changesByEvent: {"11": []} }]);
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

    expect(notes()).toEqual([{ id: "memory-activity-12", afterMessageId: "msg-last", changesByEvent: {"11": [], "12": []} }]);
  });

  it("ignores an event with no subsystem field (older backend, pre-dates skills)", async () => {
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

  it("persists the cursor across separate finished turns so a later turn's memory event is noted", async () => {
    const fetchMock = withFetch((_url, callIndex) => {
      if (callIndex <= 2) {
        // Turn 1's two checks: baseline, then nothing new.
        return jsonResponse({ events: [], latestId: 1 });
      }
      // Turn 2's first check: a background review landed since the cursor.
      return jsonResponse({
        events: [{ id: 2, subsystem: "memory", origin: "background_review" }],
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
    expect(notes()).toHaveLength(1);
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
      { id: turnNoteId(OTHER, "u1"), turnMessageId: "u1", changesByEvent: {"11": []} },
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
      { id: turnNoteId(OTHER, "u1"), turnMessageId: "u1", changesByEvent: {"12": [], "11": []} },
      { id: turnNoteId(OTHER, "u2"), turnMessageId: "u2", changesByEvent: {"13": []} },
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
      { id: turnNoteId(OTHER, "u1"), turnMessageId: "u1", changesByEvent: {"11": [], "12": []} },
    ]);
  });

  it("merges the changes of a later check into the turn's note, never listing an event twice", async () => {
    addChat(OTHER);
    const memEvent = (id: number, content: string) =>
      skillEvent(id, {
        subsystem: "memory",
        chatId: OTHER,
        messageId: "u1",
        detail: { kind: "memory", target: "memory", operations: [{ action: "add", content }] },
      });
    let call = 0;
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() => {
      call += 1;
      // The 60s check re-reads event 11 (racing tab / cursor not yet written) plus a new one.
      return jsonResponse(
        call === 1
          ? { events: [memEvent(11, "A")], latestId: 11 }
          : { events: [memEvent(11, "A"), memEvent(12, "B")], latestId: 12 },
      );
    });
    const { rerender } = renderStatus();
    rerender({ status: "ready" });
    await vi.advanceTimersByTimeAsync(60_000);

    const [note] = useChatStore.getState().activityNotes[OTHER];
    expect(noteChangeList(note.changesByEvent).map((c) => (c.kind === "memory" ? c.content : ""))).toEqual(["A", "B"]);
    expect(Object.keys(note.changesByEvent ?? {})).toEqual(["11", "12"]);
  });

  it("lists add X, remove X, add X again from three events as three lines", async () => {
    addChat(OTHER);
    const ev = (id: number, op: object) =>
      skillEvent(id, {
        subsystem: "memory",
        chatId: OTHER,
        messageId: "u1",
        detail: { kind: "memory", target: "memory", operations: [op] },
      });
    const add = { action: "add", content: "X" };
    const rm = { action: "remove", oldText: "X" };
    let call = 0;
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() => {
      call += 1;
      return jsonResponse(
        call === 1
          ? { events: [ev(11, add), ev(12, rm)], latestId: 12 }
          : { events: [ev(11, add), ev(12, rm), ev(13, add)], latestId: 13 },
      );
    });
    const { rerender } = renderStatus();
    rerender({ status: "ready" });
    await vi.advanceTimersByTimeAsync(60_000);

    const [note] = useChatStore.getState().activityNotes[OTHER];
    expect(noteChangeList(note.changesByEvent).map(formatChange)).toEqual(["Remembered: X", "Forgot: X", "Remembered: X"]);
  });

  it("an id-less new event next to an already seen id still adds its change", async () => {
    addChat(OTHER);
    const base = { subsystem: "memory", chatId: OTHER, messageId: "u1" };
    const detail = (content: string) => ({ kind: "memory", target: "memory", operations: [{ action: "add", content }] });
    let call = 0;
    localStorage.setItem(CURSOR_KEY, "10");
    withFetch(() => {
      call += 1;
      return jsonResponse(
        call === 1
          ? { events: [skillEvent(11, { ...base, detail: detail("A") })], latestId: 11 }
          : {
              events: [
                skillEvent(11, { ...base, detail: detail("A") }),
                { origin: "background_review", ...base, detail: detail("B") },
              ],
              latestId: 11,
            },
      );
    });
    const { rerender } = renderStatus();
    rerender({ status: "ready" });
    await vi.advanceTimersByTimeAsync(60_000);

    const [note] = useChatStore.getState().activityNotes[OTHER];
    expect(noteChangeList(note.changesByEvent).map(formatChange)).toEqual(["Remembered: A", "Remembered: B"]);
  });

  it("treats an event with an empty or non-string field as old-shape", async () => {
    await runCheck([skillEvent(11, { chatId: "", messageId: 5 })], 11);

    expect(notes()).toEqual([{ id: "memory-activity-11", afterMessageId: "msg-last", changesByEvent: {"11": []} }]);
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
