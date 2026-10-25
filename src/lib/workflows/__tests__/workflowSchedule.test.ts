import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SCHEDULE_CONFIG,
  describeSchedule,
  dueOccurrence,
  deleteSchedule,
  getSchedule,
  listSchedules,
  subscribeSchedules,
  nextOccurrence,
  previousOccurrence,
  recordScheduledRun,
  recordScheduledSkip,
  saveSchedule,
  SCHEDULE_STORAGE_ERROR,
  type ScheduleFrequency,
} from "../workflowSchedule";
import { assertDefined } from "@/test/assertions";

const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
// 2026-10-26 is a Monday; 24 and 25 are the weekend.

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(at(26, 8));
});
afterEach(() => vi.useRealTimers());

const CONFIG_KEY = "pen.workflowSchedules";
const RUNS_KEY = "pen.workflowSchedules.runs";

const config = (over: Partial<typeof DEFAULT_SCHEDULE_CONFIG> = {}) => ({ workflowId: "wf1", ...DEFAULT_SCHEDULE_CONFIG, ...over });

describe("workflowSchedule store", () => {
  it("saves with updatedAt = now and reads it back", () => {
    const saved = saveSchedule(config());
    expect(saved.updatedAt).toBe(at(26, 8));
    expect(getSchedule("wf1")).toEqual(saved);
  });

  it("keeps run bookkeeping when the config is saved again", () => {
    saveSchedule(config());
    recordScheduledRun("wf1", { occurrenceAt: at(26, 9), runAt: at(26, 9, 1), chatId: "c1" });
    const resaved = saveSchedule(config({ message: "hi" }));
    expect(resaved).toMatchObject({ message: "hi", lastRunAt: at(26, 9, 1), lastOccurrenceAt: at(26, 9), lastChatId: "c1" });
  });

  it("a run clears the last skip; a skip keeps the last chat", () => {
    saveSchedule(config());
    recordScheduledSkip("wf1", { occurrenceAt: at(26, 9), at: at(26, 9, 1), reason: "previous-run-busy" });
    expect(getSchedule("wf1")?.lastSkip).toEqual({ at: at(26, 9, 1), reason: "previous-run-busy" });
    recordScheduledRun("wf1", { occurrenceAt: at(27, 9), runAt: at(27, 9), chatId: "c2" });
    expect(getSchedule("wf1")?.lastSkip).toBeUndefined();
  });

  it("rejects a malformed time", () => {
    expect(() => saveSchedule(config({ time: "25:00" }))).toThrow(/Invalid schedule time/);
  });

  it("keeps run bookkeeping out of the config key and the config out of the runs key", () => {
    saveSchedule(config());
    const configBefore = localStorage.getItem(CONFIG_KEY);
    recordScheduledRun("wf1", { occurrenceAt: at(26, 9), runAt: at(26, 9, 1), chatId: "c1" });
    expect(localStorage.getItem(CONFIG_KEY)).toBe(configBefore);
    expect(JSON.parse(localStorage.getItem(RUNS_KEY) ?? "{}")).toEqual({ wf1: { lastRunAt: at(26, 9, 1), lastOccurrenceAt: at(26, 9), lastChatId: "c1" } });
  });

  it("a record never overwrites a newer config", () => {
    saveSchedule(config());
    saveSchedule(config({ enabled: false, message: "newer" }));
    recordScheduledSkip("wf1", { occurrenceAt: at(26, 9), at: at(26, 9, 1), reason: "previous-run-busy" });
    expect(getSchedule("wf1")).toMatchObject({ enabled: false, message: "newer", lastOccurrenceAt: at(26, 9) });
  });

  it.each([
    ["run", (id: string) => recordScheduledRun(id, { occurrenceAt: 1, runAt: 1, chatId: "c" })],
    ["skip", (id: string) => recordScheduledSkip(id, { occurrenceAt: 1, at: 1, reason: "previous-run-busy" })],
  ])("a %s record after delete returns false and does not resurrect the schedule", (_name, record) => {
    saveSchedule(config());
    recordScheduledRun("wf1", { occurrenceAt: at(26, 9), runAt: at(26, 9), chatId: "c1" });
    deleteSchedule("wf1");
    expect(record("wf1")).toBe(false);
    expect(getSchedule("wf1")).toBeNull();
    expect(listSchedules()).toEqual([]);
    expect(JSON.parse(localStorage.getItem(RUNS_KEY) ?? "{}")).toEqual({});
  });

  it("lists ids from the config map only", () => {
    saveSchedule(config());
    localStorage.setItem(RUNS_KEY, JSON.stringify({ wf1: { lastRunAt: 5 }, ghost: { lastRunAt: 6 } }));
    expect(listSchedules().map((s) => s.workflowId)).toEqual(["wf1"]);
  });

  it("serves the same object until storage changes", () => {
    saveSchedule(config());
    expect(getSchedule("wf1")).toBe(getSchedule("wf1"));
    const first = getSchedule("wf1");
    recordScheduledRun("wf1", { occurrenceAt: at(26, 9), runAt: at(26, 9), chatId: "c1" });
    expect(getSchedule("wf1")).not.toBe(first);
  });

  it("a storage event emits only the schedules that changed", () => {
    saveSchedule(config());
    saveSchedule({ ...config(), workflowId: "wf2" });
    const listener = vi.fn();
    const unsubscribe = subscribeSchedules(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    listener.mockClear();
    localStorage.setItem(RUNS_KEY, JSON.stringify({ wf2: { lastRunAt: 7 } }));
    window.dispatchEvent(new StorageEvent("storage", { key: RUNS_KEY }));
    unsubscribe();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({ workflowId: "wf2", schedule: { lastRunAt: 7 } });
  });

  it("recording against a missing schedule returns false", () => {
    expect(recordScheduledRun("nope", { occurrenceAt: 1, runAt: 1, chatId: "c" })).toBe(false);
  });
});

describe("occurrences", () => {
  const cases: [string, ScheduleFrequency, string, number, number, number, number][] = [
    ["hourly", "hourly", "00:15", 1, at(26, 9, 20), at(26, 9, 15), at(26, 10, 15)],
    ["hourly before the minute", "hourly", "00:15", 1, at(26, 9, 10), at(26, 8, 15), at(26, 9, 15)],
    ["daily", "daily", "09:00", 1, at(26, 8), at(25, 9), at(26, 9)],
    ["weekdays on a Saturday", "weekdays", "09:00", 1, at(24, 12), at(23, 9), at(26, 9)],
    ["weekdays on Monday morning", "weekdays", "09:00", 1, at(26, 8), at(23, 9), at(26, 9)],
    ["weekly (Wednesday)", "weekly", "10:00", 3, at(26, 12), at(21, 10), at(28, 10)],
  ];

  it.each(cases)("%s", (_name, frequency, time, weekday, now, prev, next) => {
    expect(previousOccurrence({ frequency, time, weekday }, now)).toBe(prev);
    expect(nextOccurrence({ frequency, time, weekday }, now)).toBe(next);
  });

  it("an occurrence exactly at now counts as previous, not next", () => {
    const s = { frequency: "daily" as const, time: "09:00", weekday: 1 };
    expect(previousOccurrence(s, at(26, 9))).toBe(at(26, 9));
    expect(nextOccurrence(s, at(26, 9))).toBe(at(27, 9));
  });

  it("returns null for a malformed time", () => {
    const s = { frequency: "daily" as const, time: "x", weekday: 1 };
    expect(previousOccurrence(s, at(26, 9))).toBeNull();
    expect(nextOccurrence(s, at(26, 9))).toBeNull();
  });
});

describe("dueOccurrence", () => {
  it("ignores occurrences at or before updatedAt", () => {
    const s = saveSchedule(config({ frequency: "daily" }));
    expect(dueOccurrence(s, at(26, 8, 30))).toBeNull();
    expect(dueOccurrence(s, at(26, 9))).toBe(at(26, 9));
  });

  it("ignores occurrences at or before lastOccurrenceAt", () => {
    saveSchedule(config({ frequency: "daily" }));
    recordScheduledRun("wf1", { occurrenceAt: at(26, 9), runAt: at(26, 9), chatId: "c" });
    const s = getSchedule("wf1");
    assertDefined(s);
    expect(dueOccurrence(s, at(26, 17))).toBeNull();
    expect(dueOccurrence(s, at(27, 9, 1))).toBe(at(27, 9));
  });

  it("collapses several missed occurrences into the latest one", () => {
    const s = saveSchedule(config({ frequency: "daily" }));
    expect(dueOccurrence(s, at(29, 14))).toBe(at(29, 9));
  });

  it("is null when disabled", () => {
    const s = saveSchedule(config({ frequency: "daily", enabled: false }));
    expect(dueOccurrence(s, at(27, 10))).toBeNull();
  });
});

describe("describeSchedule", () => {
  it.each([
    ["hourly", "00:05", 1, "Every hour at :05"],
    ["daily", "09:00", 1, "Every day at 09:00"],
    ["weekdays", "09:30", 1, "Every weekday at 09:30"],
    ["weekly", "18:00", 5, "Every Friday at 18:00"],
    ["daily", "bad", 1, "Invalid time"],
  ] as const)("%s %s", (frequency, time, weekday, text) => {
    expect(describeSchedule({ frequency, time, weekday })).toBe(text);
  });
});

describe("saveSchedule updatedAt", () => {
  const LATER = at(26, 12);

  it("keeps updatedAt for a message-only edit", () => {
    saveSchedule(config());
    vi.setSystemTime(LATER);
    expect(saveSchedule(config({ message: "new text" })).updatedAt).toBe(at(26, 8));
  });

  it.each([
    ["frequency", { frequency: "daily" as const }],
    ["time", { time: "10:30" }],
    ["weekday", { weekday: 4 }],
  ])("moves updatedAt when the %s changes", (_name, change) => {
    saveSchedule(config());
    vi.setSystemTime(LATER);
    expect(saveSchedule(config(change)).updatedAt).toBe(LATER);
  });

  it("moves updatedAt when a disabled schedule is enabled, not when it is disabled", () => {
    saveSchedule(config());
    vi.setSystemTime(LATER);
    expect(saveSchedule(config({ enabled: false })).updatedAt).toBe(at(26, 8));
    expect(saveSchedule(config({ enabled: true })).updatedAt).toBe(LATER);
  });

  it("a due occurrence survives a message-only edit", () => {
    saveSchedule(config());
    vi.setSystemTime(at(26, 9, 5));
    const edited = saveSchedule(config({ message: "reworded" }));
    expect(dueOccurrence(edited, at(26, 9, 5))).toBe(at(26, 9));
  });
});

describe("deleteSchedule", () => {
  it("throws and leaves config and runs untouched when the config write fails", () => {
    saveSchedule(config());
    recordScheduledRun("wf1", { occurrenceAt: at(26, 9), runAt: at(26, 9), chatId: "c1" });
    const runsBefore = localStorage.getItem(RUNS_KEY);
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => deleteSchedule("wf1")).toThrow(SCHEDULE_STORAGE_ERROR);
    setItem.mockRestore();
    expect(localStorage.getItem(RUNS_KEY)).toBe(runsBefore);
    expect(getSchedule("wf1")).not.toBeNull();
  });
});

describe("storage events after this page's own writes", () => {
  it("does not re-emit a change this page made itself", () => {
    const unsubscribe = subscribeSchedules(() => {});
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    saveSchedule(config());
    const listener = vi.fn();
    const unsubscribeSpy = subscribeSchedules(listener);
    window.dispatchEvent(new StorageEvent("storage", { key: CONFIG_KEY }));
    unsubscribeSpy();
    unsubscribe();
    expect(listener).not.toHaveBeenCalled();
  });
});
