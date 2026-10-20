import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeTrace, traceList, traceRead } from "../traceTools";
import { getAgentPanelTraceTabsBridge } from "@/lib/agentPanel";
import { sampleTrace, sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";

type Traces = NonNullable<NonNullable<Window["penAgentPanel"]>["traces"]>;

const run = async (h: (a: Record<string, unknown>, c?: never) => Promise<string>, args: Record<string, unknown> = {}) => JSON.parse(await h(args));
const raw = (h: (a: Record<string, unknown>, c?: never) => Promise<string>, args: Record<string, unknown> = {}) => h(args);

function setTraces(traces: Partial<Traces> | undefined) {
  window.penAgentPanel = traces ? ({ version: 3, traces } as unknown as Window["penAgentPanel"]) : undefined;
}

beforeEach(() => setTraces(undefined));
afterEach(() => setTraces(undefined));

describe("getAgentPanelTraceTabsBridge", () => {
  it("needs both listTabs and read", () => {
    expect(getAgentPanelTraceTabsBridge()).toBeUndefined();
    setTraces({ listTabs: async () => ({ tabs: [] }) });
    expect(getAgentPanelTraceTabsBridge()).toBeUndefined();
    setTraces({ listTabs: async () => ({ tabs: [] }), read: async () => ({ error: "x" }) });
    expect(getAgentPanelTraceTabsBridge()).toBeDefined();
  });
});

describe("trace_list", () => {
  it("returns the tabs from the bridge", async () => {
    const tabs = [{ traceId: "a", title: "Run A", active: true }, { traceId: "b", title: "Run B", active: false }];
    setTraces({ listTabs: async () => ({ tabs }), read: async () => ({ error: "x" }) });
    expect(await run(traceList)).toEqual({ tabs });
  });

  it("keeps only valid tab entries and clips the catch message", async () => {
    const valid = { traceId: "ok", title: "Run", active: true };
    setTraces({ listTabs: async () => ({ tabs: [null, { id: 1 }, { traceId: 5 }, valid, { traceId: "b", title: 7, active: "yes" }] }) as never, read: async () => ({ error: "x" }) });
    expect(await run(traceList)).toEqual({ tabs: [valid, { traceId: "b", title: "Trace", active: false }] });
    setTraces({ listTabs: async () => { throw new Error("e".repeat(2000)); }, read: async () => ({ error: "x" }) });
    expect((await run(traceList)).error.length).toBeLessThan(600);
  });

  it("errors without a bridge, on a bridge error and on a throw", async () => {
    expect((await run(traceList)).error).toMatch(/not available/);
    setTraces({ listTabs: async () => ({ error: "no shell" }), read: async () => ({ error: "x" }) });
    expect(await run(traceList)).toEqual({ error: "no shell" });
    setTraces({ listTabs: async () => { throw new Error("boom"); }, read: async () => ({ error: "x" }) });
    expect(await run(traceList)).toEqual({ error: "boom" });
  });
});

describe("trace_read", () => {
  const withTrace = (trace: unknown) => {
    const read = vi.fn(async () => ({ trace }) as never);
    setTraces({ listTabs: async () => ({ tabs: [] }), read });
    return read;
  };

  it("summarizes steps, QA, console and network without any image", async () => {
    const read = withTrace(sampleTraceJson());
    const text = await raw(traceRead, { traceId: "sample-trace-1" });
    expect(read).toHaveBeenCalledWith("sample-trace-1", { frames: false });
    const out = JSON.parse(text);
    expect(out).toMatchObject({ traceId: "sample-trace-1", status: "done", goal: sampleTrace.goal, labels: { browser: "cloud", mode: "qa" } });
    expect(out.durationMs).toBe(9000);
    expect(out.steps.total).toBe(8);
    expect(out.steps.shown[4]).toMatchObject({ index: 4, ok: false, error: expect.stringContaining("not found") });
    expect(out.steps.shown[0].url).toBe("https://acme.test/");
    expect(out.qa).toMatchObject({ outcome: "failed", verdict: "fail" });
    expect(out.qa.checks.shown[1]).toMatchObject({ passed: false, actual: "text not found" });
    expect(out.consoleErrors.total).toBe(2);
    expect(out.failedRequests.shown[1].text).toContain("POST 500");
    expect(text).not.toMatch(/data:image|base64|frames|iVBOR/);
  });

  it("caps long lists and strings and says how many are omitted", async () => {
    const json = sampleTraceJson() as typeof sampleTrace;
    const step = json.steps[0];
    json.steps = Array.from({ length: 200 }, (_, i) => ({ ...step, index: i, error: "e".repeat(5000).slice(0, 2000) }));
    json.console = Array.from({ length: 100 }, (_, i) => ({ at: 1, text: `err ${i} ${"x".repeat(1000)}` }));
    const text = await raw(traceRead, { traceId: (withTrace(json), "sample-trace-1") });
    const out = JSON.parse(text);
    expect(out.steps.shown.length).toBeLessThan(200);
    expect(out.steps.omitted).toBe(200 - out.steps.shown.length);
    expect(out.consoleErrors.omitted).toBeGreaterThan(0);
    expect(out.steps.shown[0].error.length).toBeLessThan(400);
    expect(text.length).toBeLessThan(30_000);
  });

  it("never throws: bad input, no bridge, bridge error, unparsable trace, throw", async () => {
    expect((await run(traceRead, {})).error).toMatch(/traceId is required/);
    expect((await run(traceRead, { traceId: "x" })).error).toMatch(/not available/);
    setTraces({ listTabs: async () => ({ tabs: [] }), read: async () => ({ error: "Trace not found" }) });
    expect(await run(traceRead, { traceId: "x" })).toEqual({ error: "Trace not found" });
    withTrace({ format: "nope" });
    expect((await run(traceRead, { traceId: "x" })).error).toMatch(/not valid/);
    setTraces({ listTabs: async () => ({ tabs: [] }), read: async () => { throw new Error("ipc down"); } });
    expect(await run(traceRead, { traceId: "x" })).toEqual({ error: "ipc down" });
  });
});

describe("summarizeTrace hardening", () => {
  const base = () => sampleTraceJson() as typeof sampleTrace;

  it("includes a clipped step result", () => {
    const json = base();
    json.steps[0] = { ...json.steps[0], output: "ok ".repeat(1000) };
    const out = summarizeTrace(json) as { steps: { shown: { output: string }[] } };
    expect(out.steps.shown[0].output.length).toBeLessThan(700);
    expect(out.steps.shown[0].output).toContain("more chars");
  });

  it("removes every kind of data URL", () => {
    const json = base();
    json.steps[0] = {
      ...json.steps[0],
      output: 'a data:image/svg+xml;charset=utf-8;base64,PHN2Zz4= b "data:image/svg+xml,%3Csvg%20xmlns%3D%22x%22%3E" c data:image/png;base64,iVBORw0KGgo= d',
    };
    const text = JSON.stringify(summarizeTrace(json));
    expect(text).not.toMatch(/PHN2Zz4|%3Csvg|iVBORw0|charset/);
    expect(text).toContain("[image omitted]");
  });

  it("drops a malformed field and keeps the rest", () => {
    const json = base() as unknown as Record<string, unknown>;
    json.startedAt = Number.MAX_SAFE_INTEGER; // new Date(...).toISOString() throws
    json.qa = { outcome: "failed", judge: "oops", checks: "nope" };
    const out = summarizeTrace(json as never) as Record<string, unknown>;
    expect(out.startedAt).toBeUndefined();
    expect(out.goal).toBe(sampleTrace.goal);
    expect(out.qa).toMatchObject({ outcome: "failed", checks: { total: 0 } });
    json.qa = { outcome: "failed", judge: null, checks: [null, 3, { source: "dom", check: { a: 1n } }, { source: "dom", passed: true, check: { ok: 1 } }] };
    const out2 = summarizeTrace(json as never) as { qa: { checks: { total: number; shown: Record<string, unknown>[] } } };
    expect(out2.qa.checks.total).toBe(2);
    expect(out2.qa.checks.shown[1]).toMatchObject({ source: "dom", passed: true });
  });

  it("caps labels, and a trace with huge labels still fits", async () => {
    const json = base();
    json.labels = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`key-${i}-${"k".repeat(200)}`, "v".repeat(5000)]));
    const out = summarizeTrace(json) as { labels: Record<string, string>; labelsOmitted: number };
    expect(Object.keys(out.labels).length).toBe(20);
    expect(out.labelsOmitted).toBe(4980);
    setTraces({ listTabs: async () => ({ tabs: [] }), read: async () => ({ trace: json }) as never });
    const text = await raw(traceRead, { traceId: "sample-trace-1" });
    expect(text.length).toBeLessThan(30_000);
    expect(JSON.parse(text).error).toBeUndefined();
  });
});
