import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleTraceJson } from "@/components/trace/__fixtures__/sampleTrace";
import { loadBrowseTrace, traceSourceFromParam } from "../browseTraceLoad";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as { penDesktop?: unknown }).penDesktop;
});

const stubFetch = (response: Partial<Response> | Error) =>
  vi.stubGlobal("fetch", vi.fn(() => (response instanceof Error ? Promise.reject(response) : Promise.resolve(response))));

describe("traceSourceFromParam", () => {
  it("defaults to the cloud", () => {
    expect(traceSourceFromParam("local")).toBe("local");
    expect(traceSourceFromParam("cloud")).toBe("cloud");
    expect(traceSourceFromParam(null)).toBe("cloud");
  });
});

describe("loadBrowseTrace (cloud)", () => {
  it("loads and validates a trace", async () => {
    stubFetch({ ok: true, status: 200, json: async () => sampleTraceJson() });
    const result = await loadBrowseTrace("sample-trace-1", "cloud");
    expect(result).toMatchObject({ ok: true, trace: { id: "sample-trace-1" } });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("/api/browse/traces/sample-trace-1");
  });

  it.each([
    [{ ok: false, status: 404 }, "not-found"],
    [{ ok: false, status: 400 }, "not-found"],
    [{ ok: false, status: 500 }, "error"],
    [{ ok: true, status: 200, json: async () => ({ format: "other" }) }, "invalid"],
    [{ ok: true, status: 200, json: async () => Promise.reject(new Error("bad json")) }, "invalid"],
    [new Error("offline"), "error"],
  ])("maps %j to %s", async (response, reason) => {
    stubFetch(response as Partial<Response> | Error);
    expect(await loadBrowseTrace("x", "cloud")).toMatchObject({ ok: false, reason });
  });
});

describe("loadBrowseTrace (local)", () => {
  it("reports a missing desktop bridge", async () => {
    expect(await loadBrowseTrace("x", "local")).toMatchObject({ ok: false, reason: "no-bridge" });
  });

  it("validates the trace the bridge returns", async () => {
    const read = vi.fn(async () => ({ trace: sampleTraceJson() }));
    (window as unknown as { penDesktop: unknown }).penDesktop = { traces: { read } };
    expect(await loadBrowseTrace("sample-trace-1", "local")).toMatchObject({ ok: true });
    expect(read).toHaveBeenCalledWith("sample-trace-1");
  });

  it.each([
    [{ error: "Trace not found" }, "not-found"],
    [{ error: "disk failure" }, "error"],
    [{ nope: 1 }, "invalid"],
    [{ trace: { format: "x" } }, "invalid"],
  ])("maps %j to %s", async (answer, reason) => {
    (window as unknown as { penDesktop: unknown }).penDesktop = { traces: { read: async () => answer } };
    expect(await loadBrowseTrace("x", "local")).toMatchObject({ ok: false, reason });
  });
});
