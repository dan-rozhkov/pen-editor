import { afterEach, describe, expect, it, vi } from "vitest";
import { assertErr, assertOk } from "@/test/assertions";
import { canListLocalTraces, listLocalTraces } from "../browseTraceList";

const bridge = (list: unknown) => {
  (window as { penDesktop?: unknown }).penDesktop = { traces: { list } };
};

afterEach(() => {
  delete (window as { penDesktop?: unknown }).penDesktop;
});

describe("listLocalTraces", () => {
  it("is unavailable without the bridge or an older shell", async () => {
    expect(canListLocalTraces()).toBe(false);
    assertErr(await listLocalTraces());
    (window as { penDesktop?: unknown }).penDesktop = { traces: {} };
    expect(canListLocalTraces()).toBe(false);
  });

  it("returns the traces and drops bad entries", async () => {
    bridge(
      vi.fn(async () => ({
        traces: [{ id: "a", goal: "G", startedAt: 5, status: "done", qaOutcome: "passed" }, { id: 1 }, null, { id: "b", goal: "H", startedAt: "x" }, { id: "c", goal: "I", startedAt: 7 }],
      })),
    );
    expect(canListLocalTraces()).toBe(true);
    const result = await listLocalTraces();
    assertOk(result);
    expect(result.traces).toEqual([
      { id: "a", goal: "G", startedAt: 5, status: "done", qaOutcome: "passed" },
      { id: "c", goal: "I", startedAt: 7, status: "" },
    ]);
  });

  it.each([
    ["an error answer", async () => ({ error: "disk full" }), "disk full"],
    ["a thrown error", async () => Promise.reject(new Error("boom")), "boom"],
    ["an unexpected answer", async () => ({ nope: 1 }), "unexpected"],
  ])("fails softly on %s", async (_name, list, message) => {
    bridge(list);
    const result = await listLocalTraces();
    assertErr(result);
    expect(result.message).toContain(message);
  });
});
