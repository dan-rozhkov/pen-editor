import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { fitTracePayload, saveBrowseTrace, TRACE_SAVE_SAFETY_MARGIN_MS, TRACE_SAVE_TIMEOUT_MS } from "../browseTraces";

const JPEG = `data:image/jpeg;base64,${"/9j/".repeat(40)}`;
const readStub = async () => ({ error: "n/a" });
const trace: BrowseTrace = {
  format: "sideform.browse-trace",
  version: 1,
  id: "t1",
  goal: "g",
  startedAt: 1,
  endedAt: 2,
  status: "done",
  steps: [],
  frames: [{ id: 0, at: 1, kind: "step", src: JPEG }],
  console: [],
  network: [],
};

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  delete window.penDesktop;
  delete window.penAgentPanel;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("saveBrowseTrace", () => {
  it("desktop: saves through the agent panel bridge with frames split out", async () => {
    const save = vi.fn(async () => ({ id: "p1" }));
    window.penAgentPanel = { version: 2, traces: { save, open: vi.fn() } };
    await expect(saveBrowseTrace(trace, true)).resolves.toEqual({ id: "p1", source: "local" });
    const [payload] = save.mock.calls[0] as unknown as [{ manifest: BrowseTrace; assets: Array<{ path: string; dataUrl: string }> }];
    expect(payload.assets).toEqual([expect.objectContaining({ path: "frames/0.jpg", dataUrl: JPEG })]);
    expect(payload.manifest.frames[0].src).toBe("frames/0.jpg");
  });

  it("desktop: falls back to the editor tab bridge", async () => {
    const save = vi.fn(async () => ({ id: "d1" }));
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save, read: readStub } };
    await expect(saveBrowseTrace(trace, true)).resolves.toEqual({ id: "d1", source: "local" });
  });

  it("desktop without a save bridge stores nothing and never uploads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveBrowseTrace(trace, true)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("desktop: an {error} answer logs and gives no trace", async () => {
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save: async () => ({ error: "disk full" }), read: readStub } };
    await expect(saveBrowseTrace(trace, true)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "disk full");
  });

  it("cloud: POSTs manifest and assets to /api/browse/traces", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "c1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveBrowseTrace(trace, false)).resolves.toEqual({ id: "c1", source: "cloud" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/browse/traces");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.assets).toHaveLength(1);
    expect(body.manifest.id).toBe("t1");
  });

  it("cloud: an HTTP error or a network failure gives no trace", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(saveBrowseTrace(trace, false)).resolves.toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    await expect(saveBrowseTrace(trace, false)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout when the save hangs", async () => {
    vi.useFakeTimers();
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save: () => new Promise(() => {}), read: readStub } };
    const pending = saveBrowseTrace(trace, true);
    await vi.advanceTimersByTimeAsync(TRACE_SAVE_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "timed out");
  });
});

describe("saveBrowseTrace budget and stop", () => {
  it("skips the save when the outer timeout leaves no room", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveBrowseTrace(trace, false, { outerEnd: Date.now() + TRACE_SAVE_SAFETY_MARGIN_MS - 1 })).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("waits no longer than the time left before the outer timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const pending = saveBrowseTrace(trace, false, { outerEnd: Date.now() + TRACE_SAVE_SAFETY_MARGIN_MS + 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "timed out");
  });

  it("Stop aborts the upload and stops the wait", async () => {
    let sent: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => {
      sent = init?.signal as AbortSignal;
      return new Promise(() => {});
    }));
    const stop = new AbortController();
    const pending = saveBrowseTrace(trace, false, { signal: stop.signal });
    await vi.waitFor(() => expect(sent).toBeDefined());
    stop.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(sent?.aborted).toBe(true);
  });

  it("Stop ends the wait for a hanging shell save", async () => {
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save: () => new Promise(() => {}), read: readStub } };
    const stop = new AbortController();
    const pending = saveBrowseTrace(trace, true, { signal: stop.signal });
    stop.abort();
    await expect(pending).resolves.toBeUndefined();
  });
});

describe("fitTracePayload", () => {
  const frame = (id: number, stepIndex?: number) => ({ id, at: id, kind: "step" as const, src: `frames/${id}.jpg`, ...(stepIndex !== undefined ? { stepIndex } : {}) });
  const payload = (n: number, failedStep?: number) => ({
    manifest: {
      ...trace,
      steps: Array.from({ length: n }, (_, i) => ({ index: i, tool: "browse_act", args: {}, startedAt: 0, endedAt: 1, ok: i !== failedStep })),
      frames: Array.from({ length: n }, (_, i) => frame(i, i)),
    },
    assets: Array.from({ length: n }, (_, i) => ({ path: `frames/${i}.jpg`, dataUrl: "x".repeat(1000), contentType: "image/jpeg" })),
  });

  it("returns a payload that fits unchanged", () => {
    const p = payload(5);
    expect(fitTracePayload(p, 1_000_000)).toBe(p);
  });

  it("drops middle frames evenly, keeps first, last and failed-step frames, and counts them", () => {
    const p = payload(10, 4);
    const out = fitTracePayload(p, 6_000 + JSON.stringify(p.manifest).length);
    const ids = out.manifest.frames.map((f) => f.id);
    expect(ids).toContain(0);
    expect(ids).toContain(9);
    expect(ids).toContain(4);
    expect(ids.length).toBeLessThan(10);
    expect(out.manifest.dropped?.frames).toBe(10 - ids.length);
    expect(out.assets.map((a) => a.path).sort()).toEqual(out.manifest.frames.map((f) => f.src).sort());
    const dropped = [...Array(10).keys()].filter((i) => !ids.includes(i));
    // Spread out, not a block.
    expect(dropped.some((d, i) => i > 0 && d - dropped[i - 1] > 1) || dropped.length === 1).toBe(true);
  });

  it("adds to an existing dropped count and never goes below the kept frames", () => {
    const p = payload(6);
    p.manifest.dropped = { frames: 3 };
    const out = fitTracePayload(p, 1);
    expect(out.manifest.frames.map((f) => f.id)).toEqual([0, 5]);
    expect(out.manifest.dropped?.frames).toBe(7);
  });
});
