import { describe, expect, it } from "vitest";
import { sampleTrace } from "../__fixtures__/sampleTrace";
import {
  NO_LOG_FILTER,
  batchProgress,
  droppedRequests,
  filterLogEntries,
  filteredCount,
  formatBytes,
  framesOfStep,
  pickStepFrame,
  requestFailed,
  requestText,
  requestWaterfall,
  stepActions,
  stepFromParam,
  stepLinkUrl,
  traceRequests,
  browserLabel,
  buildStepRows,
  buildTimeline,
  describeCheck,
  describeOutcome,
  describeOutcomeOf,
  filmstripLayout,
  filmstripTiles,
  formatDuration,
  formatOffset,
  lastFrameOfStep,
  parseNetworkEntry,
  prettyText,
  shortUrl,
  stepOfFrame,
  stepsWithProblems,
  summarizeArgs,
  traceTitle,
} from "../traceModel";

describe("formatting", () => {
  it.each([
    [0, "0 ms"],
    [840, "840 ms"],
    [3200, "3.2 s"],
    [12_400, "12 s"],
    [65_000, "1 m 05 s"],
  ])("formatDuration(%i) = %s", (ms, text) => expect(formatDuration(ms)).toBe(text));

  it("formats offsets as m:ss.s", () => {
    expect(formatOffset(3150)).toBe("+0:03.2");
    expect(formatOffset(75_000)).toBe("+1:15.0");
  });

  it("cuts long goals in the title", () => {
    expect(traceTitle("Buy milk")).toBe("Buy milk");
    expect(traceTitle("x".repeat(100)).length).toBeLessThan(75);
  });
});

describe("summarizeArgs", () => {
  it.each([
    ["browse_open", { url: "https://acme.test/pricing?x=1" }, "acme.test/pricing"],
    ["browse_act", { action: "click", target: "Pricing" }, "click Pricing"],
    ["browse_act", { action: "type", target: "Email", text: "a@b.c" }, "type Email “a@b.c”"],
    ["browse_act", { actions: [{ action: "click", index: 3 }, { action: "press", key: "Enter" }] }, "click #3 +1 more"],
    ["browse_tabs", { action: "list" }, "list"],
    ["browse_read", {}, ""],
    ["custom", { note: "hello" }, "hello"],
    ["custom", "plain", "plain"],
  ])("%s %j", (tool, args, expected) => expect(summarizeArgs(tool, args)).toBe(expected));

  it("keeps an unparsable url as it is", () => expect(shortUrl("not a url")).toBe("not a url"));
});

describe("describeOutcome", () => {
  it("prefers the QA outcome", () => {
    expect(describeOutcome(sampleTrace)).toEqual({ label: "QA failed", tone: "danger" });
  });

  it.each([
    ["done", "Done", "success"],
    ["setup_failed", "Setup failed", "danger"],
    ["aborted", "Aborted", "warning"],
    ["weird", "Weird", "neutral"],
  ])("maps status %s", (status, label, tone) => {
    expect(describeOutcome({ ...sampleTrace, qa: undefined, status })).toEqual({ label, tone });
  });
});

describe("describeOutcomeOf", () => {
  it.each([
    [{ status: "done", qaOutcome: "passed" }, "QA passed", "success"],
    [{ status: "done" }, "Done", "success"],
    [{ status: "error_limit" }, "Error limit", "danger"],
    [{ status: "" }, "Unknown", "neutral"],
  ])("maps %j", (input, label, tone) => {
    expect(describeOutcomeOf(input)).toEqual({ label, tone });
  });
});

describe("browserLabel", () => {
  it("names the browser, or the desktop app the run drove", () => {
    expect(browserLabel({ ...sampleTrace, labels: { browser: "cloud" } })).toBe("Cloud browser");
    expect(browserLabel({ ...sampleTrace, labels: { browser: "desktop" } })).toBe("Desktop browser");
    expect(browserLabel({ ...sampleTrace, labels: { browser: "desktop", app: "Orca" } })).toBe("Orca");
    expect(browserLabel({ ...sampleTrace, labels: undefined })).toBeUndefined();
  });
});

describe("step rows", () => {
  it("scales duration bars against the longest step", () => {
    const rows = buildStepRows(sampleTrace);
    expect(rows).toHaveLength(8);
    expect(Math.max(...rows.map((r) => r.ratio))).toBe(1);
    expect(rows[4]!.step.ok).toBe(false);
    expect(rows[2]!.summary).toBe("click Pricing");
  });

  it("flags failed steps and steps with log entries", () => {
    expect([...stepsWithProblems(sampleTrace)].sort()).toEqual([0, 2, 4]);
  });
});

describe("frame selection", () => {
  it("takes the last frame of a step", () => {
    expect(lastFrameOfStep(sampleTrace, 3)?.id).toBe(2);
  });

  it("falls back to the latest earlier frame for a step without its own", () => {
    expect(lastFrameOfStep(sampleTrace, 1)?.id).toBe(0);
    expect(lastFrameOfStep(sampleTrace, 99)).toBeUndefined();
  });

  it("maps a frame back to a step", () => {
    const [first, , , , , final] = sampleTrace.frames;
    expect(stepOfFrame(sampleTrace, first!)).toBe(0);
    expect(stepOfFrame(sampleTrace, final!)).toBe(7);
  });
});

describe("buildTimeline", () => {
  it("places frames and steps proportionally", () => {
    const timeline = buildTimeline(sampleTrace);
    expect(timeline.span).toBe(9000);
    expect(timeline.frames[0]!.pct).toBeCloseTo((1950 / 9000) * 100);
    expect(timeline.steps[4]).toMatchObject({ ok: false });
  });

  it("copes with an empty run", () => {
    const empty = { ...sampleTrace, steps: [], frames: [], endedAt: sampleTrace.startedAt };
    expect(buildTimeline(empty).span).toBe(1);
  });
});

describe("filmstripTiles", () => {
  const timeline = buildTimeline(sampleTrace); // frames at 1950, 3150, 3950, 7650, 8350, 8900 of 9000 ms
  const withPcts = (pcts: number[]) => ({ ...timeline, frames: pcts.map((pct) => ({ frame: timeline.frames[0]!.frame, pct })) });
  const homes = (tiles: ReturnType<typeof filmstripTiles>) => tiles.flatMap((t, slot) => (t.home ? [[slot, t.frameIndex]] : []));

  it("gives every frame exactly one home tile, in order, for any n from the frame count up", () => {
    for (let n = timeline.frames.length; n <= 40; n++) {
      const tiles = filmstripTiles(timeline, n);
      expect(tiles).toHaveLength(n);
      expect(homes(tiles).map(([, frame]) => frame)).toEqual([0, 1, 2, 3, 4, 5]);
    }
  });

  it("puts a frame in the slot that holds its time", () => {
    // 20 slots of 450 ms: 1950 -> 4, 3150 -> 7, 3950 -> 8, 7650 -> 17, 8350 -> 18, 8900 -> 19
    expect(homes(filmstripTiles(timeline, 20))).toEqual([[4, 0], [7, 1], [8, 2], [17, 3], [18, 4], [19, 5]]);
  });

  it("grows to one tile per frame when there are fewer slots than frames", () => {
    expect(filmstripTiles(timeline, 2)).toHaveLength(6);
    expect(filmstripTiles(timeline, 0)).toHaveLength(6);
  });

  it("spreads frames that share a slot to the nearest free slots, forward first", () => {
    const crowded = withPcts([41, 42, 43, 90]);
    expect(homes(filmstripTiles(crowded, 10))).toEqual([[4, 0], [5, 1], [6, 2], [9, 3]]);
  });

  it("moves frames back from the end when the end is full", () => {
    const crowded = withPcts([95, 96, 97, 99, 100]);
    expect(homes(filmstripTiles(crowded, 5))).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
    expect(homes(filmstripTiles(withPcts([10, 98, 99, 100]), 6)).map(([, f]) => f)).toEqual([0, 1, 2, 3]);
    expect(homes(filmstripTiles(withPcts([10, 98, 99, 100]), 6)).at(-1)).toEqual([5, 3]);
  });

  it("repeats the first frame before it and carries each frame forward after it", () => {
    const tiles = filmstripTiles(timeline, 20);
    expect(tiles.slice(0, 5).map((t) => t.frameIndex)).toEqual([0, 0, 0, 0, 0]);
    expect(tiles.slice(4, 9).map((t) => t.frameIndex)).toEqual([0, 0, 0, 1, 2]);
    expect(tiles.slice(8, 18).map((t) => t.frameIndex)).toEqual([2, 2, 2, 2, 2, 2, 2, 2, 2, 3]);
  });

  it("has no tiles for a run without frames", () => {
    expect(filmstripTiles(buildTimeline({ ...sampleTrace, frames: [] }), 5)).toEqual([]);
  });
});

describe("filmstripLayout", () => {
  it("fills the visible width edge to edge with as many tiles as fit", () => {
    const { n, tileW, stripW } = filmstripLayout(968, 3, 76, 8);
    expect(n).toBe(11);
    expect(stripW).toBe(968);
    expect(n * tileW + (n - 1) * 8).toBeCloseTo(968);
  });

  it("widens the strip when there are more frames than tiles that fit", () => {
    expect(filmstripLayout(300, 10, 76, 8)).toEqual({ n: 10, tileW: 76, stripW: 10 * 84 - 8 });
  });

  it("keeps one tile for a tiny width", () => {
    expect(filmstripLayout(20, 0, 76, 8)).toEqual({ n: 1, tileW: 20, stripW: 20 });
  });
});

describe("log and QA text", () => {
  it("parses failed requests", () => {
    expect(parseNetworkEntry("POST 500 https://a.test/x")).toEqual({ method: "POST", status: "500", url: "https://a.test/x", failed: true });
    expect(parseNetworkEntry("GET net::ERR_FAILED https://a.test/")?.failed).toBe(true);
    expect(parseNetworkEntry("???")).toBeNull();
  });

  it.each([
    [{ type: "text", text: "Pro" }, "Text “Pro” is visible"],
    [{ type: "text", text: "Pro", absent: true }, "Text “Pro” is absent"],
    [{ type: "url", contains: "/pricing" }, "URL contains /pricing"],
    [{ type: "element", selector: "#go", state: "enabled" }, "#go is enabled"],
    [{ type: "no_console_errors" }, "No console errors"],
    [{ type: "mystery_kind" }, "mystery kind"],
  ])("describeCheck %j", (check, text) => expect(describeCheck(check)).toBe(text));

  it("pretty-prints JSON text and leaves other text alone", () => {
    expect(prettyText('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyText("plain")).toBe("plain");
    expect(prettyText(undefined)).toBe("");
  });
});

describe("fields of newer recorders", () => {
  const T = sampleTrace.startedAt;
  const step = sampleTrace.steps[2]!;
  const withActions = (actions: unknown[] | undefined, asked: number) => ({ ...step, args: { actions: Array.from({ length: asked }, () => ({ action: "click" })) }, actions }) as typeof step;

  it("reads actions and requests when present and tolerates their absence", () => {
    expect(stepActions(step)).toBeUndefined();
    expect(traceRequests(sampleTrace)).toEqual([]);
    expect(droppedRequests(sampleTrace)).toBeUndefined();
    const trace = { ...sampleTrace, dropped: { requests: 4 }, requests: [{ at: 5, method: "GET", url: "b" }, { at: 1, method: "GET", url: "a" }] } as typeof sampleTrace;
    expect(traceRequests(trace).map((r) => r.url)).toEqual(["a", "b"]);
    expect(droppedRequests(trace)).toBe(4);
  });

  it("drops malformed requests and actions instead of failing", () => {
    const junk = {
      ...sampleTrace,
      dropped: { requests: "many" },
      requests: [
        { at: 2, method: "GET", url: "ok", requestHeaders: { a: "1", b: {} }, responseHeaders: [], responseBody: {}, status: "200" },
        { at: 1, method: "GET", url: 5 },
        { at: "x", method: "GET", url: "u" },
        null,
        "str",
      ],
    } as unknown as typeof sampleTrace;
    const [only, ...rest] = traceRequests(junk);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ url: "ok", requestHeaders: { a: "1" }, responseHeaders: undefined, responseBody: undefined, status: undefined });
    expect(droppedRequests(junk)).toBeUndefined();
    for (const bad of [{}, "x", 5, null]) expect(traceRequests({ ...sampleTrace, requests: bad } as unknown as typeof sampleTrace)).toEqual([]);
    expect(stepActions({ ...step, actions: "x" } as unknown as typeof step)).toBeUndefined();
    expect(stepActions({ ...step, actions: [{ action: "a", ok: true }, { action: 1, ok: true }, { action: "b" }, null] } as unknown as typeof step)).toEqual([{ action: "a", ok: true }]);
  });

  it("counts the actions a stopped batch did not run", () => {
    expect(batchProgress(step)).toBeNull();
    expect(batchProgress(withActions([{ action: "a", ok: true }, { action: "b", ok: false }], 5))).toEqual({ total: 5, ran: 2, notRun: 3 });
    expect(batchProgress(withActions([{ action: "a", ok: true }], 1))?.notRun).toBe(0);
  });

  it("finds the frames before and after a step", () => {
    const two = framesOfStep(sampleTrace, 2);
    expect([two.before?.id, two.after?.id, two.fallback]).toEqual([0, 1, undefined]);
    const snapshot = framesOfStep(sampleTrace, 1); // no screenshot of its own
    expect([snapshot.before?.id, snapshot.after, snapshot.fallback?.id]).toEqual([0, undefined, 0]);
    expect(framesOfStep(sampleTrace, 99)).toEqual({});
    expect(framesOfStep(sampleTrace, 0).before).toBeUndefined();
  });

  it("picks the frame to show and whether Before / After can differ", () => {
    const own = framesOfStep(sampleTrace, 2);
    expect(pickStepFrame(own, "after")).toMatchObject({ kind: "own", canCompare: true, frame: { id: 1 } });
    expect(pickStepFrame(own, "before")).toMatchObject({ kind: "before", frame: { id: 0 } });
    const same = framesOfStep(sampleTrace, 1); // the earlier frame is both
    expect(pickStepFrame(same, "before")).toMatchObject({ kind: "earlier", canCompare: false, frame: { id: 0 } });
    const mid = { before: sampleTrace.frames[0], fallback: sampleTrace.frames[1] };
    expect(pickStepFrame(mid, "after")).toMatchObject({ kind: "earlier", canCompare: true, frame: { id: 1 } });
    expect(pickStepFrame(mid, "before").frame?.id).toBe(0);
    expect(pickStepFrame({}, "after")).toMatchObject({ frame: undefined, canCompare: false });
  });

  it("filters log entries by step, time and text", () => {
    const entries = [
      { at: T + 100, stepIndex: 0, text: "Favicon missing" },
      { at: T + 2500, text: "late error" },
      { at: T + 9000, stepIndex: 5, text: "other" },
    ];
    const textOf = (e: { text: string }) => e.text;
    const two = sampleTrace.steps[2]!; // 2300..3100
    expect(filterLogEntries(entries, NO_LOG_FILTER, two, textOf)).toHaveLength(3);
    expect(filterLogEntries(entries, { scope: "step", query: "" }, two, textOf).map(textOf)).toEqual(["late error"]);
    expect(filterLogEntries(entries, { scope: "step", query: "" }, sampleTrace.steps[0], textOf).map(textOf)).toEqual(["Favicon missing"]);
    expect(filterLogEntries(entries, { scope: "all", query: " FAVICON " }, undefined, textOf).map(textOf)).toEqual(["Favicon missing"]);
    expect(filterLogEntries(entries, { scope: "step", query: "" }, undefined, textOf)).toHaveLength(3);
    // An entry tagged with another step stays out even when its time falls inside this one.
    const tagged = [{ at: T + 2500, stepIndex: 5, text: "other step" }];
    expect(filterLogEntries(tagged, { scope: "step", query: "" }, two, textOf)).toEqual([]);
    expect(filteredCount(3, 12)).toBe("3 of 12");
    expect(filteredCount(12, 12)).toBe("12");
  });

  it("judges, describes and places requests", () => {
    const ok = { at: T + 900, method: "GET", url: "https://a.test/x", status: 200, durationMs: 1800 };
    expect(requestFailed(ok)).toBe(false);
    expect(requestFailed({ ...ok, status: 404 })).toBe(true);
    expect(requestFailed({ ...ok, status: undefined, error: "net::ERR_FAILED" })).toBe(true);
    expect(requestText({ ...ok, status: undefined, error: "x" })).toBe("GET error https://a.test/x");
    expect(requestWaterfall(sampleTrace, ok)).toEqual({ startPct: 10, widthPct: 20 });
    const late = requestWaterfall(sampleTrace, { ...ok, at: T + 8990, durationMs: 5000 });
    expect(late.startPct + late.widthPct).toBeLessThanOrEqual(100);
    expect(requestWaterfall(sampleTrace, { ...ok, durationMs: undefined }).widthPct).toBe(0.5);
  });

  it.each([
    [0, "0 B"],
    [999, "999 B"],
    [3400, "3.4 kB"],
    [25_000, "25 kB"],
    [1_250_000, "1.3 MB"],
  ])("formats %d bytes as %s", (bytes, text) => expect(formatBytes(bytes)).toBe(text));

  it("reads and writes the deep link, one-based", () => {
    expect(stepFromParam("3", sampleTrace)).toBe(2);
    expect(stepFromParam("0", sampleTrace)).toBeUndefined();
    expect(stepFromParam("99", sampleTrace)).toBeUndefined();
    expect(stepFromParam("x", sampleTrace)).toBeUndefined();
    expect(stepFromParam(null, sampleTrace)).toBeUndefined();
    expect(stepLinkUrl({ href: "https://app.test/trace/abc?src=local&step=1#x" }, 4)).toBe("https://app.test/trace/abc?src=local&step=5#x");
  });
});
