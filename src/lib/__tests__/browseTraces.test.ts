import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowseTrace } from "@sideform/browser-agent/agent/session";
import { saveBrowseTrace, TRACE_SAVE_TIMEOUT_MS } from "../browseTraces";

const JPEG = `data:image/jpeg;base64,${"/9j/".repeat(40)}`;
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
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save } };
    await expect(saveBrowseTrace(trace, true)).resolves.toEqual({ id: "d1", source: "local" });
  });

  it("desktop without a save bridge stores nothing and never uploads", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(saveBrowseTrace(trace, true)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("desktop: an {error} answer logs and gives no trace", async () => {
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save: async () => ({ error: "disk full" }) } };
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
    window.penDesktop = { onMenuCommand: () => () => {}, traces: { save: () => new Promise(() => {}) } };
    const pending = saveBrowseTrace(trace, true);
    await vi.advanceTimersByTimeAsync(TRACE_SAVE_TIMEOUT_MS);
    await expect(pending).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("[browse trace] not saved:", "timed out");
  });
});
