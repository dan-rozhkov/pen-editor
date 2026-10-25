import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: toastMock }));

import { useChatStore } from "@/store/chatStore";
import { assertDefined } from "@/test/assertions";
import { getSchedule, recordScheduledRun, saveSchedule, subscribeSchedules } from "../workflowSchedule";
import { checkScheduledWorkflows, createLockClaimer, resetKnownOccurrencesForTests, startWorkflowScheduler } from "../workflowScheduler";
import { createWorkflow, deleteWorkflow, stepsFromTexts } from "../workflowStore";
import { parseWorkflowAttachment } from "../workflowAttachment";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
const initialChatState = useChatStore.getState();

function setup(message = "") {
  const wf = createWorkflow({ title: "Morning check", steps: stepsFromTexts(["Open the board", "Report"]) }, "editor");
  saveSchedule({ workflowId: wf.id, enabled: true, frequency: "daily", time: "09:00", weekday: 1, message });
  return wf;
}

const chats = () => useChatStore.getState().chats;

beforeEach(() => {
  localStorage.clear();
  resetKnownOccurrencesForTests();
  toastMock.mockClear();
  useChatStore.setState({ ...initialChatState, chats: [], launchQueue: {}, activeChatId: null }, true);
  vi.useFakeTimers();
  vi.setSystemTime(at(26, 8));
});
afterEach(() => {
  Reflect.deleteProperty(navigator, "locks");
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("checkScheduledWorkflows", () => {
  it("launches a new inactive chat with message, scheduled-run line and a trailing workflow block, and records the run", () => {
    const wf = setup("  Please start.  ");
    checkScheduledWorkflows(at(26, 9, 5));

    expect(chats()).toHaveLength(1);
    const chat = chats()[0];
    expect(useChatStore.getState().activeChatId).toBeNull();
    expect(chat.title).toBe("Morning check");
    const text = useChatStore.getState().launchQueue[chat.id]?.text;
    assertDefined(text);
    expect(text.startsWith("Please start.\n\nScheduled run of this workflow for ")).toBe(true);
    expect(text).toContain(`<workflow id="${wf.id}"`);
    expect(text.trimEnd().endsWith("</workflow>")).toBe(true);
    expect(parseWorkflowAttachment(text)?.title).toBe("Morning check");
    expect(getSchedule(wf.id)).toMatchObject({ lastOccurrenceAt: at(26, 9), lastRunAt: at(26, 9, 5), lastChatId: chat.id });
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it("omits an empty message", () => {
    setup();
    checkScheduledWorkflows(at(26, 9, 5));
    const text = useChatStore.getState().launchQueue[chats()[0].id]?.text;
    expect(text?.startsWith("Scheduled run of this workflow")).toBe(true);
  });

  it("does not run twice for the same occurrence", () => {
    setup();
    checkScheduledWorkflows(at(26, 9, 5));
    checkScheduledWorkflows(at(26, 9, 6));
    checkScheduledWorkflows(at(26, 15));
    expect(chats()).toHaveLength(1);
  });

  it("runs once for several missed occurrences", () => {
    const wf = setup();
    checkScheduledWorkflows(at(29, 14));
    expect(chats()).toHaveLength(1);
    expect(getSchedule(wf.id)?.lastOccurrenceAt).toBe(at(29, 9));
  });

  it("does nothing before the first occurrence after saving", () => {
    setup();
    checkScheduledWorkflows(at(26, 8, 59));
    expect(chats()).toHaveLength(0);
  });

  it("skips and records when the previous run's chat is still busy", () => {
    const wf = setup();
    checkScheduledWorkflows(at(26, 9, 5));
    useChatStore.setState((s) => ({ chats: s.chats.map((c) => ({ ...c, isBusy: true })) }));
    checkScheduledWorkflows(at(27, 9, 5));

    expect(chats()).toHaveLength(1);
    expect(getSchedule(wf.id)).toMatchObject({ lastOccurrenceAt: at(27, 9), lastSkip: { at: at(27, 9, 5), reason: "previous-run-busy" } });
  });

  it("runs again when the previous chat is idle", () => {
    setup();
    checkScheduledWorkflows(at(26, 9, 5));
    useChatStore.setState({ launchQueue: {} }); // the hidden ChatSession consumed the payload
    checkScheduledWorkflows(at(27, 9, 5));
    expect(chats()).toHaveLength(2);
  });

  it.each([
    ["is busy", { isBusy: true }, false],
    ["needs an answer", { needsAnswer: true }, false],
    ["still has its launch payload queued", {}, true],
  ])("skips and records when the previous run's chat %s", (_name, chatPatch, keepQueue) => {
    const wf = setup();
    checkScheduledWorkflows(at(26, 9, 5));
    useChatStore.setState((s) => ({ chats: s.chats.map((c) => ({ ...c, ...chatPatch })), launchQueue: keepQueue ? s.launchQueue : {} }));
    checkScheduledWorkflows(at(27, 9, 5));
    expect(chats()).toHaveLength(1);
    expect(getSchedule(wf.id)).toMatchObject({ lastOccurrenceAt: at(27, 9), lastSkip: { reason: "previous-run-busy" } });
  });

  it("treats an occurrence this panel already recorded as taken even when storage reads stale", () => {
    setup();
    checkScheduledWorkflows(at(26, 9, 5));
    localStorage.removeItem("pen.workflowSchedules.runs");
    checkScheduledWorkflows(at(26, 9, 6));
    expect(chats()).toHaveLength(1);
  });

  it("treats an occurrence announced by a change payload as taken even when storage reads stale", () => {
    const wf = setup();
    // Registered before the scheduler, so it runs first: it makes this window's storage look stale.
    const unsubscribeStale = subscribeSchedules(() => localStorage.removeItem("pen.workflowSchedules.runs"));
    const stop = startWorkflowScheduler();
    vi.setSystemTime(at(26, 9, 5));
    recordScheduledRun(wf.id, { occurrenceAt: at(26, 9), runAt: at(26, 9, 1), chatId: "other-window-chat" });
    stop();
    unsubscribeStale();
    expect(getSchedule(wf.id)?.lastOccurrenceAt).toBeUndefined();
    expect(chats()).toHaveLength(0);
  });

  it("deletes the schedule of a deleted workflow", () => {
    const wf = setup();
    deleteWorkflow(wf.id, "editor");
    checkScheduledWorkflows(at(26, 9, 5));
    expect(getSchedule(wf.id)).toBeNull();
    expect(chats()).toHaveLength(0);
  });

  it("leaves the schedule alone when the workflow body is unreadable", () => {
    const wf = setup();
    localStorage.setItem(`pen.workflows.wf.${wf.id}`, "{not json");
    checkScheduledWorkflows(at(26, 9, 5));
    expect(getSchedule(wf.id)).not.toBeNull();
    expect(chats()).toHaveLength(0);
  });

  it("does nothing, and records nothing, when offline; runs once back online", () => {
    const wf = setup();
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    checkScheduledWorkflows(at(26, 9, 5));
    expect(chats()).toHaveLength(0);
    expect(getSchedule(wf.id)?.lastOccurrenceAt).toBeUndefined();
    online.mockReturnValue(true);
    checkScheduledWorkflows(at(26, 9, 6));
    expect(chats()).toHaveLength(1);
  });

  it("does nothing when the schedule is disabled", () => {
    const wf = setup();
    saveSchedule({ workflowId: wf.id, enabled: false, frequency: "daily", time: "09:00", weekday: 1, message: "" });
    vi.setSystemTime(at(26, 8, 1));
    checkScheduledWorkflows(at(27, 9, 5));
    expect(chats()).toHaveLength(0);
  });
});

/** A minimal Web Locks stand-in: `ifAvailable` requests, a lock is held until its callback's promise settles. */
function createFakeLocks() {
  const held = new Set<string>();
  const request = vi.fn(async (name: string, _options: unknown, callback: (lock: object | null) => unknown) => {
    if (held.has(name)) return callback(null);
    held.add(name);
    try {
      return await callback({ name });
    } finally {
      held.delete(name);
    }
  });
  return { locks: { request } as unknown as LockManager, request, held };
}

describe("per-occurrence claim", () => {
  it("refuses a second claimer for the same occurrence and grants another occurrence", async () => {
    const { locks, held } = createFakeLocks();
    const first = createLockClaimer(locks);
    const second = createLockClaimer(locks);
    const launchedFirst = vi.fn();
    const launchedSecond = vi.fn();
    const launchedOther = vi.fn();
    first.claim("wf", 100, launchedFirst);
    second.claim("wf", 100, launchedSecond);
    second.claim("wf", 200, launchedOther);
    await vi.advanceTimersByTimeAsync(0);
    expect(launchedFirst).toHaveBeenCalledTimes(1);
    expect(launchedSecond).not.toHaveBeenCalled();
    expect(launchedOther).toHaveBeenCalledTimes(1);
    expect([...held].sort()).toEqual(["pen.workflowScheduler.run.wf.100", "pen.workflowScheduler.run.wf.200"]);
  });

  it("holds the lock for 10 minutes, then frees it", async () => {
    const { locks, held } = createFakeLocks();
    const { claim } = createLockClaimer(locks);
    claim("wf", 100, vi.fn());
    await vi.advanceTimersByTimeAsync(9 * 60 * 1000);
    expect(held.size).toBe(1);
    await vi.advanceTimersByTimeAsync(61 * 1000);
    expect(held.size).toBe(0);
  });

  it("release() frees the held locks early", async () => {
    const { locks, held } = createFakeLocks();
    const { claim, release } = createLockClaimer(locks);
    claim("wf", 100, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(held.size).toBe(0);
  });

  it("two windows over one fake lock manager start one chat", async () => {
    setup();
    const { locks } = createFakeLocks();
    const windowA = createLockClaimer(locks).claim;
    const windowB = createLockClaimer(locks).claim;
    checkScheduledWorkflows(at(26, 9, 5), windowA);
    resetKnownOccurrencesForTests();
    localStorage.removeItem("pen.workflowSchedules.runs"); // window B's storage has not synced yet
    checkScheduledWorkflows(at(26, 9, 5), windowB);
    await vi.advanceTimersByTimeAsync(0);
    expect(chats()).toHaveLength(1);
  });

  it("the started scheduler claims through navigator.locks and releases on stop", async () => {
    const { locks, request, held } = createFakeLocks();
    Object.defineProperty(navigator, "locks", { value: locks, configurable: true });
    setup();
    vi.setSystemTime(at(26, 9, 5));
    const stop = startWorkflowScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(chats()).toHaveLength(1);
    stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(held.size).toBe(0);
  });
});

describe("re-entrancy", () => {
  it("a schedule change does not run a pass synchronously, only from a timer", () => {
    setup();
    const stop = startWorkflowScheduler();
    vi.setSystemTime(at(26, 9, 5));
    const other = createWorkflow({ title: "Other", steps: stepsFromTexts(["x"]) }, "editor");
    saveSchedule({ workflowId: other.id, enabled: true, frequency: "daily", time: "10:00", weekday: 1, message: "" });
    expect(chats()).toHaveLength(0);
    vi.advanceTimersByTime(0);
    stop();
    expect(chats()).toHaveLength(1);
  });

  it("an echo tick during a pass repeats the pass afterwards instead of nesting it", () => {
    setup();
    setup();
    const unsubscribeEcho = subscribeSchedules(() => window.dispatchEvent(new Event("focus")));
    vi.setSystemTime(at(26, 9, 5));
    const stop = startWorkflowScheduler();
    vi.advanceTimersByTime(10);
    stop();
    unsubscribeEcho();
    expect(chats()).toHaveLength(2);
  });
});

describe("orphan schedules", () => {
  it("deleting a workflow deletes its schedule at once while the scheduler runs", () => {
    const wf = setup();
    const stop = startWorkflowScheduler();
    deleteWorkflow(wf.id, "editor");
    stop();
    expect(getSchedule(wf.id)).toBeNull();
  });

  it("a pass deletes a schedule whose workflow body key is missing, even when nothing is due", () => {
    const wf = setup();
    localStorage.removeItem(`pen.workflows.wf.${wf.id}`);
    checkScheduledWorkflows(at(26, 8, 1));
    expect(getSchedule(wf.id)).toBeNull();
  });

  it("a pass leaves a schedule with an unparseable body", () => {
    const wf = setup();
    localStorage.setItem(`pen.workflows.wf.${wf.id}`, "{not json");
    checkScheduledWorkflows(at(26, 8, 1));
    expect(getSchedule(wf.id)).not.toBeNull();
  });
});
