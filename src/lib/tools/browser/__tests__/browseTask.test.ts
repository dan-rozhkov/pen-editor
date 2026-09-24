import { afterEach, describe, expect, it, vi } from "vitest";
import { browseTask, runBrowseTaskLoop } from "@/lib/tools/browser/browseTask";
import { BROWSER_NOT_AVAILABLE_ERROR } from "@/lib/tools/browser/shared";

type PenDesktopBrowser = NonNullable<NonNullable<typeof window.penDesktop>["browser"]>;

function stubBrowser(overrides: Partial<PenDesktopBrowser>): PenDesktopBrowser {
  return {
    open: async () => ({}),
    act: async () => ({}),
    findImages: async () => ({}),
    read: async () => ({}),
    snapshot: async () => ({
      url: "https://example.com",
      title: "Example",
      elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
      snapshotId: "snap-1",
    }),
    perform: async () => ({}),
    ...overrides,
  };
}

// Every /api/browse/step call in these tests returns one JSON payload from a
// fixed sequence — the Nth call gets payloads[N], and the last entry repeats
// once exhausted (so a two-item sequence models "act once, then done
// forever"). `onRequest` is only wired up by the couple of tests that also
// need to inspect the request body the loop sent.
type StepPayload = Record<string, unknown>;

function stubFetchSequence(payloads: StepPayload[], onRequest?: (init: RequestInit) => void) {
  let calls = 0;
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    onRequest?.(init as RequestInit);
    const payload = payloads[Math.min(calls, payloads.length - 1)];
    calls++;
    return { ok: true, json: async () => payload };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

// Decisions reused verbatim across several scenarios below.
const CLICK_STEP = { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" };
const DONE = { outcome: "done", confidence: 1, model: "jev" };
const TYPE_TEXT_STEP = {
  outcome: "act",
  operation: "TYPE_TEXT",
  index: 0,
  text: "headphones",
  confidence: 0.9,
  model: "jev",
};
const PRESS_ENTER_STEP = { outcome: "act", operation: "PRESS_ENTER", confidence: 0.9, model: "jev" };
const PRESS_ESCAPE_STEP = { outcome: "act", operation: "PRESS_ESCAPE", confidence: 0.9, model: "jev" };
const HOVER_STEP = { outcome: "act", operation: "HOVER", index: 0, confidence: 0.9, model: "jev" };

afterEach(() => {
  delete window.penDesktop;
  vi.unstubAllGlobals();
});

describe("browse_task", () => {
  it("returns the documented error when window.penDesktop.browser is absent (web build)", async () => {
    expect(window.penDesktop).toBeUndefined();

    const result = JSON.parse(await browseTask({ goal: "accept cookies" }));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("terminates on outcome:done and returns the documented transcript shape", async () => {
    stubFetchSequence([CLICK_STEP, { outcome: "done", confidence: 1, model: "jev", reason: "cookie banner dismissed" }]);

    const browser = stubBrowser({});
    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.reason).toBe("cookie banner dismissed");
    expect(transcript.url).toBe("https://example.com");
    expect(transcript.title).toBe("Example");
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "Accept all", ok: true, index: 0 },
    ]);
  });

  it("terminates on outcome:blocked without performing the blocked step", async () => {
    const perform = vi.fn(async () => ({}));
    stubFetchSequence([{ outcome: "blocked", confidence: 0.2, model: "jev", reason: "confidence below threshold" }]);

    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("log in", 12, browser);

    expect(transcript.status).toBe("blocked");
    expect(transcript.reason).toBe("confidence below threshold");
    expect(transcript.steps).toEqual([]);
    expect(perform).not.toHaveBeenCalled();
  });

  it("records outcome:retry as a step and continues the loop instead of ending the task", async () => {
    // A single transient Jev blip (timeout/malformed answer/no candidate
    // element) must not kill the whole task — addendum B's whole point.
    stubFetchSequence([
      { outcome: "retry", confidence: 0.4, model: "jev", reason: "no candidate element" },
      { outcome: "done", confidence: 1, model: "jev", reason: "goal met" },
    ]);

    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("find a red sneaker", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      { operation: "RETRY", label: "no candidate element", ok: false },
    ]);
    expect(perform).not.toHaveBeenCalled();
  });

  it("treats a missing/unrecognized outcome defensively — recorded and continued, not claimed as success", async () => {
    stubFetchSequence([
      { operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }, // no `outcome` at all
      { outcome: "some_future_value", confidence: 0.9, model: "jev" },
    ]);

    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("wander forever", 2, browser);

    expect(transcript.status).toBe("budget");
    expect(perform).not.toHaveBeenCalled();
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "unrecognized step outcome: undefined", ok: false },
      { operation: "UNKNOWN_OUTCOME", label: "unrecognized step outcome: some_future_value", ok: false },
    ]);
  });

  it("sleeps and re-snapshots on WAIT without ever calling perform", async () => {
    // Addendum A: WAIT never reaches `perform`; the loop handles it itself.
    stubFetchSequence([{ outcome: "act", operation: "WAIT", confidence: 0.9, model: "jev" }, DONE]);

    let snapshotCalls = 0;
    const snapshot = vi.fn(async () => {
      snapshotCalls++;
      return {
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
        snapshotId: `snap-${snapshotCalls}`,
      };
    });
    const perform = vi.fn(async () => ({}));
    const sleep = vi.fn(async () => {});
    const browser = stubBrowser({ snapshot, perform });

    const transcript = await runBrowseTaskLoop(
      "wait for the page to load",
      12,
      browser,
      undefined,
      sleep
    );

    expect(transcript.status).toBe("done");
    expect(perform).not.toHaveBeenCalled();
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(400);
    expect(snapshotCalls).toBe(2);
    expect(transcript.steps).toEqual([
      { operation: "WAIT", label: "waiting for the page to settle", ok: true },
    ]);
  });

  it("forwards a scroll decision to perform without an `index` key when none is given", async () => {
    stubFetchSequence([{ outcome: "act", operation: "SCROLL_DOWN", confidence: 0.9, model: "jev" }]);

    const perform = vi.fn(async (_args: Parameters<PenDesktopBrowser["perform"]>[0]) => ({}));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("scroll down", 1, browser);

    expect(perform).toHaveBeenCalledTimes(1);
    const performArgs = perform.mock.calls[0][0];
    expect(performArgs).not.toHaveProperty("index");
    expect(performArgs).toMatchObject({ operation: "SCROLL_DOWN", snapshotId: "snap-1" });
    expect(transcript.steps).toEqual([{ operation: "SCROLL_DOWN", label: "", ok: true }]);
  });

  it("records a CLICK decision missing its index as a failed step and never calls perform", async () => {
    stubFetchSequence([{ outcome: "act", operation: "CLICK", confidence: 0.9, model: "jev" }]);

    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("click something", 1, browser);

    expect(perform).not.toHaveBeenCalled();
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "missing index for a non-scroll operation", ok: false },
    ]);
  });

  it("stops at maxSteps when the loop never resolves outcome:done/blocked", async () => {
    stubFetchSequence([CLICK_STEP]);

    const browser = stubBrowser({});
    const transcript = await runBrowseTaskLoop("wander forever", 3, browser);

    expect(transcript.status).toBe("budget");
    expect(transcript.reason).toBe("maxSteps reached");
    expect(transcript.steps).toHaveLength(3);
  });

  it("caps maxSteps at the hard cap of 25 even when a larger value is requested", async () => {
    stubFetchSequence([CLICK_STEP]);

    const browser = stubBrowser({});
    const transcript = await runBrowseTaskLoop("wander forever", 1000, browser);

    expect(transcript.steps).toHaveLength(25);
  });

  it("stops once the deadline is reached, before maxSteps", async () => {
    stubFetchSequence([{ operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }]);

    const browser = stubBrowser({});
    let clock = 0;
    // Each loop iteration advances the fake clock past the 90s deadline
    // after the first step, so the loop must stop on the deadline check
    // rather than running out maxSteps.
    const now = () => {
      const value = clock;
      clock += 91_000;
      return value;
    };

    const transcript = await runBrowseTaskLoop("wander forever", 12, browser, now);

    expect(transcript.status).toBe("budget");
    expect(transcript.reason).toBe("deadline exceeded");
    expect(transcript.steps).toHaveLength(0);
  });

  it("records a failing perform step without ending the task", async () => {
    stubFetchSequence([CLICK_STEP, DONE]);

    const perform = vi
      .fn()
      .mockRejectedValueOnce(new Error("stale snapshotId"))
      .mockResolvedValue({});
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "stale snapshotId", ok: false, index: 0 },
    ]);
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("records a failing snapshot/step call without ending the task", async () => {
    let snapshotCalls = 0;
    const snapshot = vi.fn(async () => {
      snapshotCalls++;
      if (snapshotCalls === 1) {
        throw new Error("page navigating");
      }
      return {
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
        snapshotId: "snap-2",
      };
    });
    stubFetchSequence([DONE]);

    const browser = stubBrowser({ snapshot });
    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      { operation: "SNAPSHOT", label: "page navigating", ok: false },
    ]);
  });

  it("forwards goal and maxSteps from args and returns a real JSON string", async () => {
    let receivedBody: unknown;
    stubFetchSequence([DONE], (init) => {
      receivedBody = JSON.parse(init.body as string);
    });

    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({}),
    };

    const result = await browseTask({ goal: "find a red sneaker", maxSteps: 5 });

    expect(typeof result).toBe("string");
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.status).toBe("done");
    expect(parsed).toHaveProperty("steps");
    expect(parsed).toHaveProperty("url");
    expect(parsed).toHaveProperty("title");
    expect(receivedBody).toMatchObject({ goal: "find a red sneaker" });
  });
  // Upstream jev-ultrafast PR #40, ported: a rejected act must be recorded
  // as a no-op (the bridge resolves `{ error }`, it never rejects), and
  // three consecutive steps that land nothing end the task instead of
  // spending a paid Jev call per cycle until maxSteps runs out.
  it("records a perform that resolved with { error } as a failed step, not a landed action", async () => {
    stubFetchSequence([CLICK_STEP, DONE]);

    const perform = vi
      .fn()
      .mockResolvedValueOnce({ error: "Stale or unknown snapshotId — the page may have changed." })
      .mockResolvedValue({});
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.steps).toEqual([
      {
        operation: "CLICK",
        label: "Stale or unknown snapshotId — the page may have changed.",
        ok: false,
        index: 0,
      },
    ]);
  });

  it("stops with status:stalled after three consecutive steps that land nothing", async () => {
    const fetchMock = stubFetchSequence([CLICK_STEP]);

    // A persistently stale target: every act is rejected by the desktop
    // controller, so the loop would otherwise run all 12 steps.
    const perform = vi.fn(async () => ({ error: "target is gone or occluded" }));
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("click the popover", 12, browser);

    expect(transcript.status).toBe("stalled");
    expect(transcript.reason).toMatch(/no progress/i);
    expect(transcript.steps).toHaveLength(3);
    expect(perform).toHaveBeenCalledTimes(3);
    // Three decisions paid for, not twelve.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("resets the no-progress count on a step that did land", async () => {
    // Five CLICK decisions, then done — matched against the five perform
    // outcomes below (fail, fail, land, fail, fail).
    stubFetchSequence([CLICK_STEP, CLICK_STEP, CLICK_STEP, CLICK_STEP, CLICK_STEP, DONE]);

    // fail, fail, land, fail, fail — never three in a row, so the task runs
    // to its own conclusion.
    const perform = vi
      .fn()
      .mockResolvedValueOnce({ error: "target is gone" })
      .mockResolvedValueOnce({ error: "target is gone" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ error: "target is gone" })
      .mockResolvedValue({ error: "target is gone" });
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("click something", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps.map((step) => step.ok)).toEqual([false, false, true, false, false]);
  });

  // Full browser use (docs/superpowers/specs/
  // 2026-09-23-full-browser-use-design.md): PRESS_ENTER/PRESS_ESCAPE and
  // HOVER dispatch through browser.act, not browser.perform.
  it("dispatches PRESS_ENTER as browser.act({action:'press', key:'Enter'}) right after a landed TYPE_TEXT", async () => {
    stubFetchSequence([TYPE_TEXT_STEP, PRESS_ENTER_STEP, DONE]);

    const act = vi.fn(async () => ({}));
    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ act, perform });
    const transcript = await runBrowseTaskLoop("submit the form", 12, browser);

    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith({ action: "press", key: "Enter" });
    expect(perform).toHaveBeenCalledTimes(1);
    expect(transcript.steps).toEqual([
      { operation: "TYPE_TEXT", label: "Accept all", ok: true, index: 0 },
      { operation: "PRESS_ENTER", label: "press Enter", ok: true },
    ]);
  });

  it("refuses PRESS_ENTER without calling the bridge when the last landed step was not TYPE_TEXT", async () => {
    stubFetchSequence([PRESS_ENTER_STEP, DONE]);

    const act = vi.fn(async () => ({}));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("submit the form", 12, browser);

    expect(act).not.toHaveBeenCalled();
    expect(transcript.steps).toEqual([
      {
        operation: "PRESS_ENTER",
        label: "Enter is only pressed right after typing into a field",
        ok: false,
      },
    ]);
  });

  it("refuses a second PRESS_ENTER right after the first (a landed PRESS_ENTER is not TYPE_TEXT)", async () => {
    // TYPE_TEXT once, then PRESS_ENTER decided twice in a row (the loop
    // never reaches outcome:done here — maxSteps below is what ends it).
    stubFetchSequence([TYPE_TEXT_STEP, PRESS_ENTER_STEP]);

    const act = vi.fn(async () => ({}));
    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ act, perform });
    const transcript = await runBrowseTaskLoop("submit the form", 3, browser);

    expect(act).toHaveBeenCalledTimes(1); // only the first PRESS_ENTER lands
    expect(transcript.steps[0]).toEqual({ operation: "TYPE_TEXT", label: "Accept all", ok: true, index: 0 });
    expect(transcript.steps[1]).toEqual({ operation: "PRESS_ENTER", label: "press Enter", ok: true });
    expect(transcript.steps[2]).toEqual({
      operation: "PRESS_ENTER",
      label: "Enter is only pressed right after typing into a field",
      ok: false,
    });
  });

  it("dispatches PRESS_ESCAPE as browser.act({action:'press', key:'Escape'})", async () => {
    stubFetchSequence([PRESS_ESCAPE_STEP, DONE]);

    const act = vi.fn(async () => ({}));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("close the modal", 12, browser);

    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith({ action: "press", key: "Escape" });
    expect(transcript.steps).toEqual([{ operation: "PRESS_ESCAPE", label: "press Escape", ok: true }]);
  });

  it("dispatches HOVER as browser.act({action:'hover', index, snapshotId}) using the current step's snapshotId", async () => {
    stubFetchSequence([HOVER_STEP, DONE]);

    const act = vi.fn(async () => ({}));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("reveal the menu", 12, browser);

    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith({ action: "hover", index: 0, snapshotId: "snap-1" });
    expect(transcript.steps).toEqual([{ operation: "HOVER", label: "Accept all", ok: true, index: 0 }]);
  });

  it("records a HOVER decision missing its index as a failed step and never calls act", async () => {
    stubFetchSequence([{ outcome: "act", operation: "HOVER", confidence: 0.9, model: "jev" }]);

    const act = vi.fn(async () => ({}));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("hover something", 1, browser);

    expect(act).not.toHaveBeenCalled();
    expect(transcript.steps).toEqual([
      { operation: "HOVER", label: "missing index for a non-scroll operation", ok: false },
    ]);
  });

  it("records a { error }-resolved act (PRESS_ENTER/HOVER) as a failed step, not a landed action", async () => {
    stubFetchSequence([TYPE_TEXT_STEP, PRESS_ENTER_STEP, DONE]);

    const act = vi.fn(async () => ({ error: "nothing is focused" }));
    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ act, perform });
    const transcript = await runBrowseTaskLoop("submit", 12, browser);

    expect(transcript.steps).toEqual([
      { operation: "TYPE_TEXT", label: "Accept all", ok: true, index: 0 },
      { operation: "PRESS_ENTER", label: "nothing is focused", ok: false },
    ]);
  });

  it("counts a changed:false act result (PRESS_ESCAPE/HOVER/PRESS_ENTER) as unproductive for stall detection", async () => {
    // Escape with nothing open to close: the act "succeeds" (no `{error}`)
    // but reports changed:false — must be treated like a rejected act for
    // the no-progress counter, or a persistently no-op Escape would run out
    // the whole step budget the same way a persistently stale CLICK target
    // used to before PR #40.
    const fetchMock = stubFetchSequence([PRESS_ESCAPE_STEP]);

    const act = vi.fn(async () => ({ changed: false }));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("close the modal", 12, browser);

    expect(transcript.status).toBe("stalled");
    expect(transcript.steps).toHaveLength(3);
    expect(act).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(transcript.steps.every((step) => step.ok === false)).toBe(true);
  });

  it("folds openedTab into the step label/history when an act or perform result carries one", async () => {
    stubFetchSequence([CLICK_STEP, DONE]);

    const perform = vi.fn(async () => ({
      openedTab: { tabId: 7, url: "https://example.com/new", title: "New Tab" },
    }));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("open a link", 12, browser);

    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "Accept all → opened tab: New Tab", ok: true, index: 0 },
    ]);
  });

  it("folds dialogs into the step label/history when a result carries them", async () => {
    stubFetchSequence([PRESS_ESCAPE_STEP, DONE]);

    const act = vi.fn(async () => ({
      dialogs: [{ tabId: 1, type: "alert", message: "Saved!" }],
    }));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("submit", 12, browser);

    expect(transcript.steps).toEqual([
      { operation: "PRESS_ESCAPE", label: "press Escape (dialog auto-handled: alert: Saved!)", ok: true },
    ]);
  });

  it("truncates an over-long opened-tab title/dialog message so the resulting history label stays within the backend's 200-char cap", async () => {
    const receivedBodies: Array<{ history?: Array<{ label: string }> }> = [];
    const longTitle = "T".repeat(300);
    const longMessage = "M".repeat(300);
    stubFetchSequence([CLICK_STEP, DONE], (init) => {
      receivedBodies.push(JSON.parse(init.body as string));
    });

    const perform = vi.fn(async () => ({
      openedTab: { tabId: 7, url: "https://example.com/new", title: longTitle },
      dialogs: [{ type: "alert", message: longMessage }],
    }));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("open a link", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps[0].label.length).toBeLessThanOrEqual(200);

    // The SECOND /api/browse/step request body carries the history entry
    // for step one — this is the request that would 400 against the
    // backend's `label: z.string().max(200)` schema if truncation didn't
    // happen.
    const secondRequestHistory = receivedBodies[1]?.history ?? [];
    expect(secondRequestHistory).toHaveLength(1);
    expect(secondRequestHistory[0]!.label.length).toBeLessThanOrEqual(200);
  });

  it("surfaces a snapshot that resolved with { error } instead of reporting it as malformed", async () => {
    stubFetchSequence([DONE]);

    const snapshot = vi.fn(async () => ({ error: "No browser tab is open — call browse_open first." }));
    const browser = stubBrowser({ snapshot });

    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("stalled");
    expect(transcript.steps).toEqual([
      { operation: "SNAPSHOT", label: "No browser tab is open — call browse_open first.", ok: false },
      { operation: "SNAPSHOT", label: "No browser tab is open — call browse_open first.", ok: false },
      { operation: "SNAPSHOT", label: "No browser tab is open — call browse_open first.", ok: false },
    ]);
  });
});
