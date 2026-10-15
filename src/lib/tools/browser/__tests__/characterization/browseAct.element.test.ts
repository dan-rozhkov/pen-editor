import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browseAct } from "@/lib/tools/browser/browseAct";
import { BROWSER_NOT_AVAILABLE_ERROR } from "@/lib/tools/browser/shared";
import { bridgeWith, FOUND, j, resetEnvironment, snap, snapThenFail, stubLocate, throws } from "./harness";

vi.mock("@/lib/cloudBrowser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cloudBrowser")>()),
  cloudBrowserBridge: undefined,
  getCloudBrowserBridge: () => undefined,
}));

afterEach(resetEnvironment);

const EL = [{ index: 2, tag: "button", label: "Search", ops: ["CLICK"] }];
const PRE = snap("pre-1", EL);
const POST = snap("post-2", EL);
const NOTE_STALE =
  "this call took a fresh snapshot to resolve `element` — earlier snapshotIds are now stale; use this snapshotId for further index-based browse_act calls";
const noteNewer = (id: string) =>
  `a newer snapshot was taken after this action settled — use snapshot.snapshotId ("${id}") for further index-based browse_act calls, not the snapshotId this "resolved" carried`;
const UNSUPPORTED = (a: string) =>
  `browse_act: "element" is only supported for click, type, select, hover, and press actions (got "${a}"). Use target or index instead.`;

describe("browse_act element: locate success", () => {
  it("snapshot -> locate -> act(index, snapshotId) -> trailing snapshot; resolved is reconciled", async () => {
    const bridge = bridgeWith({ snapshot: [PRE, POST], act: [{ url: "u", title: "t", matched: "Search" }] });
    const locate = stubLocate([{ body: FOUND(2, { label: "Search", confidence: 0.87 }) }]);

    const out = await browseAct({ action: "click", element: "the search button" });

    expect(bridge.calls).toEqual([
      { method: "snapshot", args: [] },
      { method: "act", args: [{ action: "click", index: 2, snapshotId: "pre-1" }] },
      { method: "snapshot", args: [] },
    ]);
    expect(locate.requests).toHaveLength(1);
    expect(locate.requests[0].url).toMatch(/\/api\/browse\/locate$/);
    expect(locate.requests[0].method).toBe("POST");
    expect(locate.requests[0].hasSignal).toBe(true);
    // Exact wire body, including key order.
    expect(locate.requests[0].rawBody).toBe(
      j({ description: "the search button", operation: "CLICK", url: "https://example.com/", title: "Example", elements: EL })
    );
    expect(out).toBe(
      j({
        url: "u",
        title: "t",
        matched: "Search",
        resolved: { index: 2, label: "Search", confidence: 0.87, note: noteNewer("post-2") },
        snapshot: POST,
      })
    );
  });

  it("keeps resolved.snapshotId and the original note when the trailing snapshot fails", async () => {
    bridgeWith({ snapshot: [PRE, { error: "gone" }], act: [{ url: "u" }] });
    stubLocate([{ body: FOUND(2) }]);
    const out = await browseAct({ action: "click", element: "x" });
    expect(out).toBe(
      j({
        url: "u",
        resolved: { index: 2, label: "Go", confidence: 0.9, snapshotId: "pre-1", note: NOTE_STALE },
      })
    );
  });

  it("does not attach a snapshot when act reports changed:false; resolved keeps its snapshotId", async () => {
    const bridge = bridgeWith({ snapshot: [PRE, POST], act: [{ changed: false }] });
    stubLocate([{ body: FOUND(2) }]);
    const out = await browseAct({ action: "click", element: "x" });
    expect(bridge.methods()).toEqual(["snapshot", "act"]);
    expect(out).toBe(
      j({
        changed: false,
        resolved: { index: 2, label: "Go", confidence: 0.9, snapshotId: "pre-1", note: NOTE_STALE },
      })
    );
  });

  it("includes resolved on an act error and reconciles it with the trailing snapshot", async () => {
    bridgeWith({ snapshot: [PRE, POST], act: [{ error: "element is covered" }] });
    stubLocate([{ body: FOUND(2) }]);
    expect(await browseAct({ action: "click", element: "x" })).toBe(
      j({
        error: "element is covered",
        resolved: { index: 2, label: "Go", confidence: 0.9, note: noteNewer("post-2") },
        snapshot: POST,
      })
    );
  });

  it("includes resolved when act rejects", async () => {
    bridgeWith({ snapshot: [PRE, POST], act: [throws(new Error("timeout"))] });
    stubLocate([{ body: FOUND(2) }]);
    expect(await browseAct({ action: "click", element: "x" })).toBe(
      j({
        error: "timeout",
        resolved: { index: 2, label: "Go", confidence: 0.9, note: noteNewer("post-2") },
        snapshot: POST,
      })
    );
  });

  it("omits label/confidence from resolved when the backend did not send them", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }], act: [{}] });
    stubLocate([{ body: { outcome: "found", index: 0 } }]);
    expect(await browseAct({ action: "click", element: "x" })).toBe(
      j({ resolved: { index: 0, snapshotId: "pre-1", note: NOTE_STALE } })
    );
  });

  it("replaces a non-object act result by the malformed error; resolved cannot be merged into it", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }], act: [[1]] });
    stubLocate([{ body: FOUND(2) }]);
    expect(await browseAct({ action: "click", element: "x" })).toBe(
      j({ error: "browse_act: malformed result from the browser bridge." })
    );
  });

  it("an empty act result {} still carries resolved (callBrowserBridge coalesces undefined)", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }], act: [undefined] });
    stubLocate([{ body: FOUND(2) }]);
    const out = JSON.parse(await browseAct({ action: "click", element: "x" }));
    expect(Object.keys(out)).toEqual(["resolved"]);
  });

  it("passes extra args through, drops target:'' and element, and overrides a model-sent index/snapshotId", async () => {
    const bridge = bridgeWith({ snapshot: [PRE, POST], act: [{ changed: false }] });
    stubLocate([{ body: FOUND(2) }]);
    await browseAct({
      action: "type",
      element: "the name field",
      target: "",
      index: null,
      snapshotId: "model-old",
      text: "Ada",
      submit: true,
    });
    expect(bridge.callsTo("act")[0].args).toEqual([
      { action: "type", index: 2, snapshotId: "pre-1", text: "Ada", submit: true },
    ]);
  });

  it("maps each supported action to its locate operation", async () => {
    const map: Array<[string, Record<string, unknown>, string]> = [
      ["click", {}, "CLICK"],
      ["type", { text: "a" }, "TYPE_TEXT"],
      ["select", { text: "a" }, "SELECT"],
      ["hover", {}, "HOVER"],
      ["press", { key: "Enter" }, "FOCUS"],
    ];
    for (const [action, extra, op] of map) {
      bridgeWith({ snapshot: [PRE], act: [{ changed: false }] });
      const locate = stubLocate([{ body: FOUND(2) }]);
      await browseAct({ action, element: "e", ...extra });
      expect(locate.requests[0].body.operation).toBe(op);
    }
  });

  it("sends only valid ops/elements: HOVER-only entries are dropped, scroll containers kept, fields clamped", async () => {
    const elements = [
      { index: 0, tag: "a", label: "L".repeat(250), ops: ["CLICK", "HOVER", "BOGUS"], disabled: false, checked: true, extra: 1 },
      { index: 1, tag: "div", ops: ["HOVER"] },
      { index: 2, tag: "div", label: "list", ops: [], scrollable: true },
      { index: -1, tag: "a", ops: ["CLICK"] },
      "junk",
    ];
    bridgeWith({ snapshot: [{ ...snap("p", elements), title: "T".repeat(600), url: `https://e.com/${"u".repeat(4100)}` }], act: [{ changed: false }] });
    const locate = stubLocate([{ body: FOUND(0) }]);
    await browseAct({ action: "click", element: "d".repeat(400) });
    const body = locate.requests[0].body as { description: string; url: string; title: string; elements: unknown[] };
    expect(body.description).toBe("d".repeat(299) + "…");
    expect(body.title).toBe("T".repeat(499) + "…");
    expect(body.url).toHaveLength(4000);
    expect(body.url.endsWith("…")).toBe(true);
    expect(body.elements).toEqual([
      { index: 0, tag: "a", label: "L".repeat(199) + "…", ops: ["CLICK"], checked: true, extra: 1 },
      { index: 2, tag: "div", label: "list", ops: [], scrollable: true },
    ]);
  });

  it("repeats the snapshot+locate for an identical second call (no local cache)", async () => {
    const bridge = bridgeWith({ snapshot: [PRE], act: [{ changed: false }] });
    const locate = stubLocate([{ body: FOUND(2) }]);
    await browseAct({ action: "click", element: "x" });
    await browseAct({ action: "click", element: "x" });
    expect(locate.requests).toHaveLength(2);
    expect(bridge.methods()).toEqual(["snapshot", "act", "snapshot", "act"]);
  });

  it("does not call the backend when index or target is present", async () => {
    const bridge = bridgeWith({ act: [{ changed: false }] });
    const locate = stubLocate([{ body: FOUND(2) }]);
    await browseAct({ action: "click", element: "x", index: 0, snapshotId: "s" });
    await browseAct({ action: "click", element: "x", target: "T" });
    expect(locate.fetchMock).not.toHaveBeenCalled();
    expect(bridge.callsTo("act").map((c) => c.args)).toEqual([
      [{ action: "click", index: 0, snapshotId: "s" }],
      [{ action: "click", target: "T" }],
    ]);
  });
});

describe("browse_act element: locate outcomes that do not resolve", () => {
  const TRAIL = snap("trail-9");

  it("not_found names the reason and points at browse_snapshot (no act, trailing snapshot taken)", async () => {
    const bridge = bridgeWith({ snapshot: [PRE, TRAIL] });
    stubLocate([{ body: { outcome: "not_found", reason: "no such button" } }]);
    const out = await browseAct({ action: "click", element: "the buy button" });
    expect(bridge.methods()).toEqual(["snapshot", "snapshot"]);
    expect(out).toBe(
      j({
        error: 'No element matched "the buy button": no such button. Call browse_snapshot to see the elements and act by index.',
        snapshot: TRAIL,
      })
    );
  });

  it("not_found without a reason says 'not found'", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }] });
    stubLocate([{ body: { outcome: "not_found" } }]);
    expect(await browseAct({ action: "click", element: "e" })).toBe(
      j({ error: 'No element matched "e": not found. Call browse_snapshot to see the elements and act by index.' })
    );
  });

  const unsure = (el: string, why: string) =>
    j({ error: `browse_act: could not confidently resolve "${el}" (${why}). Use target or index instead.` });

  it("retry outcome, with and without a reason", async () => {
    bridgeWith({ snapshot: snapThenFail(PRE, 2) });
    stubLocate([{ body: { outcome: "retry", reason: "ambiguous" } }, { body: { outcome: "retry" } }]);
    expect(await browseAct({ action: "click", element: "e" })).toBe(unsure("e", "ambiguous"));
    expect(await browseAct({ action: "click", element: "e" })).toBe(unsure("e", "try again or be more specific"));
  });

  it("found without a numeric index is treated as unresolved", async () => {
    const bridge = bridgeWith({ snapshot: snapThenFail(PRE, 2) });
    stubLocate([{ body: { outcome: "found", index: "2" } }, { body: { outcome: "found" } }]);
    expect(await browseAct({ action: "click", element: "e" })).toBe(unsure("e", "try again or be more specific"));
    expect(await browseAct({ action: "click", element: "e" })).toBe(unsure("e", "try again or be more specific"));
    expect(bridge.callsTo("act")).toHaveLength(0);
  });

  it("an unrecognized outcome, an empty/null/non-object body, or invalid JSON are all unresolved", async () => {
    bridgeWith({ snapshot: snapThenFail(PRE, 5) });
    stubLocate([
      { body: { outcome: "weird", reason: "r" } },
      { body: {} },
      { body: null },
      { body: "text" },
      { badJson: true },
    ]);
    expect(await browseAct({ action: "click", element: "e" })).toBe(unsure("e", "r"));
    for (let i = 0; i < 4; i++) {
      expect(await browseAct({ action: "click", element: "e" })).toBe(unsure("e", "try again or be more specific"));
    }
  });

  it("found with index 0 resolves (0 is a number)", async () => {
    const bridge = bridgeWith({ snapshot: [PRE], act: [{ changed: false }] });
    stubLocate([{ body: FOUND(0) }]);
    await browseAct({ action: "click", element: "e" });
    expect(bridge.callsTo("act")[0].args).toEqual([{ action: "click", index: 0, snapshotId: "pre-1" }]);
  });

  it("503 without Retry-After means no fast model is configured", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }] });
    const locate = stubLocate([{ status: 503, body: {} }]);
    expect(await browseAct({ action: "click", element: "e" })).toBe(
      j({ error: "browse_act: element targeting is not available (no fast model configured on the backend). Use target or index instead." })
    );
    expect(locate.requests).toHaveLength(1);
  });

  it("other HTTP errors report the status", async () => {
    bridgeWith({ snapshot: snapThenFail(PRE, 2) });
    stubLocate([{ status: 400, body: {} }, { status: 500, body: {} }]);
    const err = (s: number) =>
      j({ error: `browse_act: /api/browse/locate responded ${s} while resolving "e". Use target or index instead.` });
    expect(await browseAct({ action: "click", element: "e" })).toBe(err(400));
    expect(await browseAct({ action: "click", element: "e" })).toBe(err(500));
  });

  it("a network failure reports the message (Error) or the string form (non-Error)", async () => {
    bridgeWith({ snapshot: snapThenFail(PRE, 2) });
    stubLocate([{ reject: new Error("ECONNRESET") }, { reject: "plain" }]);
    const err = (m: string) =>
      j({ error: `browse_act: /api/browse/locate failed while resolving "e" (${m}). Use target or index instead.` });
    expect(await browseAct({ action: "click", element: "e" })).toBe(err("ECONNRESET"));
    expect(await browseAct({ action: "click", element: "e" })).toBe(err("plain"));
  });
});

describe("browse_act element: snapshot failures before locate", () => {
  const cases: Array<[string, unknown, string]> = [
    ["bridge error result", { error: "tab closed" }, "tab closed"],
    ["malformed snapshot", { url: "u" }, "Malformed snapshot result"],
    ["rejecting snapshot", throws(new Error("boom")), "boom"],
    ["rejecting snapshot (non-Error)", throws("str"), "str"],
  ];
  for (const [name, step, msg] of cases) {
    it(`reports ${name} without calling the backend`, async () => {
      const bridge = bridgeWith({ snapshot: [step] });
      const locate = stubLocate([{ body: FOUND(1) }]);
      const out = await browseAct({ action: "click", element: "the thing" });
      expect(locate.fetchMock).not.toHaveBeenCalled();
      expect(bridge.methods()).toEqual(["snapshot", "snapshot"]);
      expect(out).toBe(j({ error: `browse_act: could not resolve "the thing" — snapshot failed: ${msg}` }));
    });
  }
});

describe("browse_act element: validation before any round trip", () => {
  it("rejects type/select without non-empty text (missing, blank, non-string)", async () => {
    for (const action of ["type", "select"]) {
      for (const text of [undefined, "", "   ", 5]) {
        const bridge = bridgeWith({ snapshot: [{ error: "x" }] });
        const locate = stubLocate([{ body: FOUND(1) }]);
        const args: Record<string, unknown> = { action, element: "e" };
        if (text !== undefined) args.text = text;
        const out = await browseAct(args);
        expect(out).toBe(j({ error: `browse_act: action "${action}" requires a non-empty "text" field.` }));
        expect(locate.fetchMock).not.toHaveBeenCalled();
        // pinned as-is: no locate/act, but the generic trailing snapshot is still attempted.
        expect(bridge.methods()).toEqual(["snapshot"]);
      }
    }
  });

  it("rejects press without a non-empty key", async () => {
    for (const key of [undefined, "", "  ", 13]) {
      const bridge = bridgeWith({ snapshot: [{ error: "x" }] });
      const locate = stubLocate([{ body: FOUND(1) }]);
      const args: Record<string, unknown> = { action: "press", element: "e" };
      if (key !== undefined) args.key = key;
      expect(await browseAct(args)).toBe(j({ error: 'browse_act: action "press" requires a non-empty "key" field.' }));
      expect(locate.fetchMock).not.toHaveBeenCalled();
      expect(bridge.methods()).toEqual(["snapshot"]);
    }
  });

  it("click/hover need no extra field", async () => {
    for (const action of ["click", "hover"]) {
      bridgeWith({ snapshot: [PRE], act: [{ changed: false }] });
      const locate = stubLocate([{ body: FOUND(2) }]);
      await browseAct({ action, element: "e" });
      expect(locate.requests).toHaveLength(1);
    }
  });

  it("rejects unsupported actions (scroll/back/forward/reload/wait/missing/non-string) before touching anything but the trailing snapshot", async () => {
    for (const action of ["scroll", "back", "forward", "reload", "wait", "teleport", undefined, 7]) {
      const bridge = bridgeWith({ snapshot: [{ error: "x" }] });
      const locate = stubLocate([{ body: FOUND(1) }]);
      const args: Record<string, unknown> = { element: "e" };
      if (action !== undefined) args.action = action;
      const out = await browseAct(args);
      expect(out).toBe(j({ error: UNSUPPORTED(typeof action === "string" ? action : "") }));
      expect(locate.fetchMock).not.toHaveBeenCalled();
      expect(bridge.callsTo("act")).toHaveLength(0);
    }
  });

  it("with no bridge the unsupported-action and validation errors still win over 'not available'", async () => {
    expect(await browseAct({ action: "scroll", element: "e" })).toBe(j({ error: UNSUPPORTED("scroll") }));
    expect(await browseAct({ action: "type", element: "e" })).toBe(
      j({ error: 'browse_act: action "type" requires a non-empty "text" field.' })
    );
    expect(await browseAct({ action: "click", element: "e" })).toBe(j({ error: BROWSER_NOT_AVAILABLE_ERROR }));
  });
});

describe("browse_act element: locate retry and the 25 s budget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  async function run(promise: Promise<string>, advanceMs: number) {
    await vi.advanceTimersByTimeAsync(advanceMs);
    return promise;
  }

  it("retries a 429 after 1 s backoff and then succeeds", async () => {
    const bridge = bridgeWith({ snapshot: [PRE], act: [{ changed: false }] });
    const locate = stubLocate([{ status: 429, body: {} }, { body: FOUND(2) }]);
    const p = browseAct({ action: "click", element: "e" });
    await vi.advanceTimersByTimeAsync(999);
    expect(locate.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    const out = await p;
    expect(locate.requests).toHaveLength(2);
    expect(locate.requests[1].rawBody).toBe(locate.requests[0].rawBody);
    expect(bridge.callsTo("act")).toHaveLength(1);
    expect(JSON.parse(out).changed).toBe(false);
  });

  it("uses exponential backoff 1 s then 2 s, and gives up before a third wait that would bust the budget", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }] });
    const locate = stubLocate([{ status: 429, body: {} }]);
    const out = await run(browseAct({ action: "click", element: "e" }), 3_000);
    // attempt0: 1000+20000<=25000 ok; attempt1 (t=1000): 1000+2000+20000<=25000 ok;
    // attempt2 (t=3000): 3000+4000+20000 > 25000 -> stop. 3 requests total.
    expect(locate.requests).toHaveLength(3);
    expect(out).toBe(
      j({ error: 'browse_act: /api/browse/locate responded 429 while resolving "e". Use target or index instead.' })
    );
  });

  it("honors Retry-After on a 503 (retried) and treats a 503 WITHOUT it as final", async () => {
    bridgeWith({ snapshot: [PRE], act: [{ changed: false }] });
    const locate = stubLocate([{ status: 503, retryAfter: "2", body: {} }, { body: FOUND(2) }]);
    const out = await run(browseAct({ action: "click", element: "e" }), 2_000);
    expect(locate.requests).toHaveLength(2);
    expect(JSON.parse(out).resolved.index).toBe(2);
  });

  it("does not wait for a Retry-After that cannot fit in the budget (> 5 s)", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }] });
    const locate = stubLocate([{ status: 429, retryAfter: "10", body: {} }]);
    const out = await browseAct({ action: "click", element: "e" });
    expect(locate.requests).toHaveLength(1);
    expect(out).toBe(
      j({ error: 'browse_act: /api/browse/locate responded 429 while resolving "e". Use target or index instead.' })
    );
  });

  it("retries up to 4 times when the budget allows (Retry-After 1 s each), then reports the 429", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }] });
    const locate = stubLocate([{ status: 429, retryAfter: "1", body: {} }]);
    const out = await run(browseAct({ action: "click", element: "e" }), 4_000);
    expect(locate.requests).toHaveLength(5);
    expect(JSON.parse(out).error).toContain("responded 429");
  });

  it("a retried 503 that turns into a final 503 reports 'no fast model'", async () => {
    bridgeWith({ snapshot: [PRE, { error: "x" }] });
    const locate = stubLocate([{ status: 503, retryAfter: "1", body: {} }, { status: 503, body: {} }]);
    const out = await run(browseAct({ action: "click", element: "e" }), 1_000);
    expect(locate.requests).toHaveLength(2);
    expect(JSON.parse(out).error).toContain("no fast model configured");
  });
});
