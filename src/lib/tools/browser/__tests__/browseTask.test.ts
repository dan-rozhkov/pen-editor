import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ACTION_CACHE_KILL_SWITCH_KEY,
  ACTION_CACHE_STORAGE_KEY,
  buildStepCacheKey,
  hashCachedLabel,
  lookupStepCache,
  writeStepCacheEntry,
} from "@/lib/tools/browser/actionCache";
import { browseTask, extractUrlFromGoal, runBrowseTaskLoop } from "@/lib/tools/browser/browseTask";
import { BROWSER_NOT_AVAILABLE_ERROR, type SnapshotResult } from "@/lib/tools/browser/shared";
import {
  setPenDesktop,
  stubBrowser as createBrowserStub,
  stubFetchSequence,
  type PenDesktopBrowser,
} from "./helpers";

// Most scenarios below want `snapshot()` to resolve to a real single-button
// page by default, unlike browserTools.test.ts's default `{}`.
const EXAMPLE_SNAPSHOT: SnapshotResult = {
  url: "https://example.com",
  title: "Example",
  elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
  snapshotId: "snap-1",
};

function stubBrowser(overrides: Partial<PenDesktopBrowser>): PenDesktopBrowser {
  return createBrowserStub(overrides, EXAMPLE_SNAPSHOT);
}

// Decisions reused verbatim across several scenarios below.
const CLICK_STEP = { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" };
const DONE = { outcome: "done", confidence: 1, model: "jev" };
const WAIT_LOW_CONFIDENCE_STEP = { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" };
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
  // The action cache (actionCache.ts) persists to real localStorage — clear
  // it so a write in one test can't be replayed as a cache hit in another.
  localStorage.clear();
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
    // 2, not 3: the pre-loop "is a tab already open?" probe (requirement 1)
    // succeeds here (a real snapshot, not the "no tab" error) and is REUSED
    // as the first loop iteration's snapshot (finding: it used to be thrown
    // away, doubling the snapshot cost) — so only the WAIT's follow-up
    // snapshot is a second, genuinely new call.
    expect(snapshotCalls).toBe(2);
    expect(transcript.steps).toEqual([
      { operation: "WAIT", label: "waiting for the page to settle", ok: true },
    ]);
  });

  // Live bench finding (2026-09-24): Jev chose WAIT six times in a row at
  // low confidence before anything else happened. WAIT was always recorded
  // `ok: true`, which resets MAX_CONSECUTIVE_UNPRODUCTIVE_STEPS on every
  // cycle, so an unbroken run of WAITs could never trip the stall detector.
  describe("consecutive WAIT decisions on an unchanging page (MAX_CONSECUTIVE_SAME_URL_WAITS)", () => {
    // Same url on every snapshot — nothing ever navigates.
    const FIXED_URL_SNAPSHOT: SnapshotResult = {
      url: "https://example.com",
      title: "Example",
      elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
      snapshotId: "snap-fixed",
    };

    it("stops actually sleeping on the 3rd consecutive WAIT with the same url, and eventually stalls", async () => {
      stubFetchSequence([WAIT_LOW_CONFIDENCE_STEP]);

      const snapshot = vi.fn(async () => FIXED_URL_SNAPSHOT);
      const sleep = vi.fn(async () => {});
      const browser = stubBrowser({ snapshot });

      const transcript = await runBrowseTaskLoop(
        "wait for the page to load",
        12,
        browser,
        undefined,
        sleep
      );

      expect(transcript.status).toBe("stalled");
      // Two genuine sleeps (the pre-loop probe's snapshot is WAIT #1, the
      // follow-up snapshot is WAIT #2), then WAIT #3-#5 are all recorded
      // unproductive without sleeping again — three unproductive steps in a
      // row is what actually stalls the loop.
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(transcript.steps).toEqual([
        { operation: "WAIT", label: "waiting for the page to settle", ok: true },
        { operation: "WAIT", label: "waiting for the page to settle", ok: true },
        { operation: "WAIT", label: "(waited, nothing changed)", ok: false },
        { operation: "WAIT", label: "(waited, nothing changed)", ok: false },
        { operation: "WAIT", label: "(waited, nothing changed)", ok: false },
      ]);
    });

    it("keeps sleeping on every WAIT when the url changes between them (never caps)", async () => {
      stubFetchSequence([WAIT_LOW_CONFIDENCE_STEP]);

      let snapshotCalls = 0;
      const snapshot = vi.fn(async () => {
        snapshotCalls++;
        return {
          url: `https://example.com/page-${snapshotCalls}`,
          title: "Example",
          elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
          snapshotId: `snap-${snapshotCalls}`,
        };
      });
      const sleep = vi.fn(async () => {});
      const browser = stubBrowser({ snapshot });

      const transcript = await runBrowseTaskLoop(
        "wait for navigation",
        4,
        browser,
        undefined,
        sleep
      );

      expect(transcript.status).toBe("budget");
      expect(sleep).toHaveBeenCalledTimes(4);
      expect(transcript.steps.every((step) => step.ok)).toBe(true);
      expect(transcript.steps.every((step) => step.label === "waiting for the page to settle")).toBe(
        true
      );
    });

    it("resets the same-url WAIT streak once a non-WAIT operation lands in between", async () => {
      let stepCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          stepCalls++;
          // WAIT, WAIT, CLICK (lands), then WAIT, WAIT, WAIT again — the
          // CLICK in the middle must reset the streak so the next two WAITs
          // are treated as the start of a fresh streak, not a continuation.
          const sequence = ["WAIT", "WAIT", "CLICK", "WAIT", "WAIT", "WAIT"];
          const operation = sequence[Math.min(stepCalls - 1, sequence.length - 1)];
          return {
            ok: true,
            json: async () =>
              operation === "CLICK"
                ? { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }
                : { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" },
          };
        })
      );

      const snapshot = vi.fn(async () => FIXED_URL_SNAPSHOT);
      const sleep = vi.fn(async () => {});
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ snapshot, perform });

      const transcript = await runBrowseTaskLoop(
        "wait around a click",
        6,
        browser,
        undefined,
        sleep
      );

      // Two sleeps before the CLICK, then two more after it (the streak
      // reset) — the 6th and final decision (WAIT again) is the 3rd of that
      // fresh streak and is skipped, but the loop simply runs out of
      // maxSteps before enough unproductive steps accumulate to stall.
      expect(sleep).toHaveBeenCalledTimes(4);
      expect(transcript.status).toBe("budget");
      expect(transcript.steps.map((step) => `${step.operation}:${step.ok}`)).toEqual([
        "WAIT:true",
        "WAIT:true",
        "CLICK:true",
        "WAIT:true",
        "WAIT:true",
        "WAIT:false",
      ]);
    });
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
      // Call 1 is the pre-loop "is a tab already open?" probe (requirement
      // 1) — it must succeed, and (finding: reused as the first loop
      // iteration's own snapshot) is then consumed by iteration 0 without a
      // second snapshot() call. Call 2 is iteration 1's own fresh snapshot,
      // taken after iteration 0's CLICK landed — that's the one this test
      // fails, to exercise a mid-LOOP snapshot failure.
      if (snapshotCalls === 2) {
        throw new Error("page navigating");
      }
      return {
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
        snapshotId: "snap-2",
      };
    });
    stubFetchSequence([CLICK_STEP, DONE]);

    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ snapshot, perform });
    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "Accept all", ok: true, index: 0 },
      { operation: "SNAPSHOT", label: "page navigating", ok: false },
    ]);
  });

  it("forwards goal and maxSteps from args and returns a real JSON string", async () => {
    let receivedBody: unknown;
    stubFetchSequence([DONE], (init) => {
      receivedBody = JSON.parse(init.body as string);
    });

    setPenDesktop(stubBrowser({}));

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
      { operation: "TYPE_TEXT", label: 'TYPE_TEXT "headphones" into "Accept all"', ok: true, index: 0 },
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
    expect(transcript.steps[0]).toEqual({ operation: "TYPE_TEXT", label: 'TYPE_TEXT "headphones" into "Accept all"', ok: true, index: 0 });
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
      { operation: "TYPE_TEXT", label: 'TYPE_TEXT "headphones" into "Accept all"', ok: true, index: 0 },
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

  it("surfaces a snapshot that resolved with { error } (unrelated to \"no tab\") instead of reporting it as malformed", async () => {
    stubFetchSequence([DONE]);

    // Deliberately NOT the "no browser tab is open" message — that one is
    // now intercepted by the pre-loop probe (requirement 1, covered by its
    // own describe block below) and ends the task immediately instead of
    // reaching the loop's per-step SNAPSHOT handling this test exercises.
    const snapshot = vi.fn(async () => ({
      error: "Stale or unknown snapshotId — the page may have changed.",
    }));
    const browser = stubBrowser({ snapshot });

    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("stalled");
    expect(transcript.steps).toEqual([
      { operation: "SNAPSHOT", label: "Stale or unknown snapshotId — the page may have changed.", ok: false },
      { operation: "SNAPSHOT", label: "Stale or unknown snapshotId — the page may have changed.", ok: false },
      { operation: "SNAPSHOT", label: "Stale or unknown snapshotId — the page may have changed.", ok: false },
    ]);
  });

  // browse-speed-contract.md, "Frontend" item 4.
  it("counts a perform CLICK/TYPE_TEXT/SELECT result with changed:false as unproductive, with an ok:false step and a 'no effect' reason", async () => {
    stubFetchSequence([CLICK_STEP]);

    const perform = vi.fn(async () => ({ changed: false }));
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("click the popover", 12, browser);

    expect(transcript.status).toBe("stalled");
    expect(transcript.steps).toHaveLength(3);
    expect(perform).toHaveBeenCalledTimes(3);
    expect(transcript.steps.every((step) => step.ok === false)).toBe(true);
    expect(transcript.steps[0]!.label).toMatch(/no effect/);
  });

  it("does not treat a perform result with no `changed` field as no-effect (backward compatible)", async () => {
    stubFetchSequence([CLICK_STEP, DONE]);

    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "Accept all", ok: true, index: 0 },
    ]);
  });

  // browse-speed-contract.md, "Frontend" item 2: `changed: false` +
  // `pageChanged: true` (the "Add to Cart" shape — the button itself
  // doesn't change, but a separate #cart-status element does) is NOT
  // unproductive.
  it("treats a perform result with changed:false but pageChanged:true as productive, with the new text folded into the label", async () => {
    stubFetchSequence([CLICK_STEP, DONE]);

    const perform = vi.fn(async () => ({
      changed: false,
      pageChanged: true,
      appeared: ["Added to cart (1 item)", "Go to cart"],
    }));
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("add the item to the cart", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      {
        operation: "CLICK",
        label: 'Accept all (page updated: "Added to cart (1 item)")',
        ok: true,
        index: 0,
      },
    ]);
  });

  it("treats an act result with changed:false but pageChanged:true as productive, with a plain '(page updated)' suffix when appeared is empty", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ outcome: "act", operation: "PRESS_ESCAPE", confidence: 0.9, model: "jev" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const act = vi.fn(async () => ({ changed: false, pageChanged: true, appeared: [] }));
    const browser = stubBrowser({ act });
    const transcript = await runBrowseTaskLoop("close the modal", 12, browser);

    expect(transcript.steps[0]!.ok).toBe(true);
    expect(transcript.steps[0]!.label).toContain("(page updated)");
  });

  it("still treats changed:false, pageChanged:false as unproductive — pageChanged must be explicitly true, not just missing", async () => {
    stubFetchSequence([CLICK_STEP]);

    const perform = vi.fn(async () => ({ changed: false, pageChanged: false, appeared: [] }));
    const browser = stubBrowser({ perform });

    const transcript = await runBrowseTaskLoop("click the popover", 12, browser);

    expect(transcript.status).toBe("stalled");
    expect(transcript.steps.every((step) => step.ok === false)).toBe(true);
    expect(transcript.steps[0]!.label).toMatch(/no effect/);
  });

  // browse-speed-contract.md, "Frontend" item 4.
  it("bails before starting a step once less than the per-step reserve remains, before the deadline is fully spent", async () => {
    stubFetchSequence([{ operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }]);

    const browser = stubBrowser({});
    let clock = 0;
    // Deadline is now()+90_000 at start (clock 0 -> deadline 90_000). The
    // first loop-entry check consumes one `now()` call — advance the clock
    // by exactly enough that under 15s (STEP_DEADLINE_RESERVE_MS) remains,
    // without having crossed the deadline itself.
    const now = () => {
      const value = clock;
      clock += 80_000;
      return value;
    };

    const transcript = await runBrowseTaskLoop("wander forever", 12, browser, now);

    expect(transcript.status).toBe("budget");
    expect(transcript.reason).toBe("deadline exceeded");
    // Stopped before taking even one step: 90_000 - 80_000 = 10_000 remaining
    // on the very first check, under the 35s reserve (STEP_DEADLINE_RESERVE_MS).
    expect(transcript.steps).toHaveLength(0);
  });

  // Finding: STEP_DEADLINE_RESERVE_MS was raised from 15s to 35s — this
  // exercises a case that used to PROCEED (15s < remaining < 35s) and must
  // now bail instead, since a single step's own worst case (~61.5s) far
  // exceeds a 15s reserve.
  it("bails at the new 35s reserve even when the old 15s reserve would have let the step start", async () => {
    stubFetchSequence([{ outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }]);

    const browser = stubBrowser({});
    let clock = 0;
    // Deadline is now()+90_000 at start. Advance by exactly enough that
    // 20_000ms remain — under the new 35s reserve, but comfortably over the
    // old 15s one.
    const now = () => {
      const value = clock;
      clock += 70_000;
      return value;
    };

    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser, now);

    expect(transcript.status).toBe("budget");
    expect(transcript.reason).toBe("deadline exceeded");
    expect(transcript.steps).toHaveLength(0);
  });

  // browse-speed-contract.md, "Frontend" item 4.
  it("caps the WAIT sleep by whatever remains of the deadline", async () => {
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls === 1
              ? { outcome: "act", operation: "WAIT", confidence: 0.9, model: "jev" }
              : { outcome: "done", confidence: 1, model: "jev" },
        };
      })
    );

    const browser = stubBrowser({});
    const sleep = vi.fn(async (_ms: number) => {});
    // now() is called 3 times before the sleep: (1) the initial deadline
    // calc (deadline = 0 + 90_000 = 90_000), (2) the per-step reserve check
    // (50_000 -> 40_000 remaining, comfortably over the 35s reserve, so the
    // loop proceeds), (3) the sleep's own remaining-time calc (89_900 ->
    // only 100ms left) — well under WAIT_SLEEP_MS (400ms).
    const nowValues = [0, 50_000, 89_900];
    let nowCalls = 0;
    const now = () => nowValues[Math.min(nowCalls++, nowValues.length - 1)]!;

    await runBrowseTaskLoop("wait for the page to load", 12, browser, now, sleep);

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]![0]).toBe(100);
  });

  // browse-speed-contract.md, "Backend" item 5 / "Frontend" item 4.
  it("forwards the snapshot's scroll position to /api/browse/step untouched", async () => {
    const receivedBodies: Array<{ scroll?: unknown }> = [];
    stubFetchSequence([DONE], (init) => {
      receivedBodies.push(JSON.parse(init.body as string));
    });

    const snapshot = vi.fn(async () => ({
      url: "https://example.com",
      title: "Example",
      elements: [],
      snapshotId: "snap-1",
      scroll: { y: 240, height: 1200, atBottom: false },
    }));
    const browser = stubBrowser({ snapshot });

    await runBrowseTaskLoop("scroll and read", 12, browser);

    expect(receivedBodies[0]!.scroll).toEqual({ y: 240, height: 1200, atBottom: false });
  });

  it("omits `scroll` from the /api/browse/step body when the snapshot doesn't carry one", async () => {
    const receivedBodies: Array<Record<string, unknown>> = [];
    stubFetchSequence([DONE], (init) => {
      receivedBodies.push(JSON.parse(init.body as string));
    });

    const browser = stubBrowser({});
    await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(receivedBodies[0]).not.toHaveProperty("scroll");
  });

  // The ultrafast step policy reads visible page text: from the snapshot on a
  // current desktop build, from one `read` on an older one, and a failing
  // read must never fail the step — it just goes without text.
  it.each([
    ["the snapshot's own text", { text: "Create your account" }, async () => ({ text: "unused" }), "Create your account", 0],
    ["a read fallback", {}, async () => ({ text: "Welcome back" }), "Welcome back", 1],
    ["nothing when the fallback read throws", {}, async () => { throw new Error("boom"); }, undefined, 1],
  ])("sends %s as pageText", async (_name, snapshotExtra, readImpl, expected, readCalls) => {
    const receivedBodies: Array<Record<string, unknown>> = [];
    stubFetchSequence([DONE], (init) => {
      receivedBodies.push(JSON.parse(init.body as string));
    });
    const read = vi.fn(readImpl);
    const snapshot = vi.fn(async () => ({
      url: "https://example.com",
      title: "Example",
      elements: [],
      snapshotId: "snap-1",
      ...snapshotExtra,
    }));
    await runBrowseTaskLoop("register", 12, stubBrowser({ snapshot, read }));

    expect(receivedBodies[0]!.pageText).toBe(expected);
    expect(read).toHaveBeenCalledTimes(readCalls);
  });

  // Requirement 1: browse_task opens a tab itself (via `url`, or a URL
  // sniffed out of the goal) instead of wasting Jev steps discovering there
  // is no tab open — bench finding A (3 wasted "no browser tab" steps on
  // every one of 3 live runs).
  describe("opening a tab before the loop starts (requirement 1)", () => {
    it("opens `url` before the loop starts, without any pre-loop snapshot probe", async () => {
      stubFetchSequence([{ outcome: "done", confidence: 1, model: "jev" }]);
      const open = vi.fn(async () => ({}));
      const snapshot = vi.fn(async () => ({
        url: "https://shop.example.com",
        title: "Shop",
        elements: [],
        snapshotId: "snap-1",
      }));
      const browser = stubBrowser({ open, snapshot });

      const transcript = await runBrowseTaskLoop(
        "search for headphones",
        12,
        browser,
        undefined,
        undefined,
        "https://shop.example.com"
      );

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith({ url: "https://shop.example.com" });
      expect(transcript.status).toBe("done");
    });

    it("returns status:blocked immediately when open({url}) itself fails, without entering the loop", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal("fetch", fetchMock);
      const open = vi.fn(async () => ({ error: "net::ERR_NAME_NOT_RESOLVED" }));
      const browser = stubBrowser({ open });

      const transcript = await runBrowseTaskLoop(
        "search for headphones",
        12,
        browser,
        undefined,
        undefined,
        "https://bad.example.invalid"
      );

      expect(transcript.status).toBe("blocked");
      expect(transcript.reason).toContain("net::ERR_NAME_NOT_RESOLVED");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns status:blocked with botCheck:true and never calls Jev when open({url}) lands on a bot-check wall", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal("fetch", fetchMock);
      const open = vi.fn(async () => ({ botCheck: true }));
      const browser = stubBrowser({ open });

      const transcript = await runBrowseTaskLoop(
        "search for headphones",
        12,
        browser,
        undefined,
        undefined,
        "https://protected.example.com"
      );

      expect(transcript.status).toBe("blocked");
      expect(transcript.botCheck).toBe(true);
      expect(transcript.reason).toBe("bot check / CAPTCHA wall — hand over to the user");
      expect(transcript.steps).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns status:blocked with botCheck:true when the no-url probe path opens a goal URL that lands on a bot-check wall", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal("fetch", fetchMock);
      const open = vi.fn(async () => ({ botCheck: true }));
      let snapshotCalls = 0;
      const snapshot = vi.fn(async () => {
        snapshotCalls++;
        return { error: "No browser tab is open — call browse_open first." };
      });
      const browser = stubBrowser({ open, snapshot });

      const transcript = await runBrowseTaskLoop(
        "open https://protected.example.com and search for headphones",
        12,
        browser
      );

      expect(open).toHaveBeenCalledTimes(1);
      expect(transcript.status).toBe("blocked");
      expect(transcript.botCheck).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      // Only the one pre-loop probe snapshot — the loop itself never starts.
      expect(snapshotCalls).toBe(1);
    });

    it("without `url`, probes for an already-open tab and proceeds normally when one is open (no extra open() call)", async () => {
      stubFetchSequence([{ outcome: "done", confidence: 1, model: "jev" }]);
      const open = vi.fn(async () => ({}));
      const browser = stubBrowser({ open });

      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      expect(open).not.toHaveBeenCalled();
      expect(transcript.status).toBe("done");
    });

    it("without `url` and no tab open, opens a URL found inside the goal text instead of wasting steps", async () => {
      stubFetchSequence([{ outcome: "done", confidence: 1, model: "jev" }]);
      const open = vi.fn(async () => ({}));
      let snapshotCalls = 0;
      const snapshot = vi.fn(async () => {
        snapshotCalls++;
        if (snapshotCalls === 1) {
          return { error: "No browser tab is open — call browse_open first." };
        }
        return {
          url: "https://shop.example.com",
          title: "Shop",
          elements: [],
          snapshotId: "snap-1",
        };
      });
      const browser = stubBrowser({ open, snapshot });

      const transcript = await runBrowseTaskLoop(
        "open https://shop.example.com and search for headphones",
        12,
        browser
      );

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith({ url: "https://shop.example.com" });
      expect(transcript.status).toBe("done");
    });

    it("without `url`, no open tab, and no URL in the goal, returns status:blocked immediately without ANY /api/browse/step call", async () => {
      const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
      vi.stubGlobal("fetch", fetchMock);
      const snapshot = vi.fn(async () => ({
        error: "No browser tab is open — call browse_open first.",
      }));
      const browser = stubBrowser({ snapshot });

      const transcript = await runBrowseTaskLoop("search this site for headphones", 12, browser);

      expect(transcript).toEqual({
        status: "blocked",
        steps: [],
        url: "",
        title: "",
        reason: "No browser tab is open — pass url or call browse_open first",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      // Exactly the one cheap probe call, not the three wasted Jev steps
      // bench finding A measured on main.
      expect(snapshot).toHaveBeenCalledTimes(1);
    });

    it("forwards `url` from the tool args through to the loop", async () => {
      let receivedBody: unknown;
      stubFetchSequence([DONE], (init) => {
        receivedBody = JSON.parse(init.body as string);
      });
      const open = vi.fn(async () => ({}));

      setPenDesktop(stubBrowser({ open }));

      const result = await browseTask({
        goal: "search for headphones",
        url: "https://shop.example.com",
      });
      const parsed = JSON.parse(result);

      expect(open).toHaveBeenCalledWith({ url: "https://shop.example.com" });
      expect(parsed.status).toBe("done");
      expect(receivedBody).toBeDefined();
    });

    // Finding #5: a URL named in the goal used to be silently ignored
    // whenever ANY tab happened to be open, even on a totally unrelated
    // site — only the "no tab open at all" case checked the goal for a URL.
    it("navigates to a goal URL on a DIFFERENT origin even though a tab is already open elsewhere", async () => {
      stubFetchSequence([{ outcome: "done", confidence: 1, model: "jev" }]);
      const open = vi.fn(async () => ({}));
      const snapshot = vi.fn(async () => ({
        url: "https://unrelated.example.com/dashboard",
        title: "Unrelated",
        elements: [],
        snapshotId: "snap-1",
      }));
      const browser = stubBrowser({ open, snapshot });

      const transcript = await runBrowseTaskLoop(
        "open https://shop.example.com and search for headphones",
        12,
        browser
      );

      expect(open).toHaveBeenCalledTimes(1);
      expect(open).toHaveBeenCalledWith({ url: "https://shop.example.com" });
      expect(transcript.status).toBe("done");
    });

    it("does NOT navigate when the goal URL is on the SAME origin as the already-open tab (just a different path)", async () => {
      stubFetchSequence([{ outcome: "done", confidence: 1, model: "jev" }]);
      const open = vi.fn(async () => ({}));
      const snapshot = vi.fn(async () => ({
        url: "https://shop.example.com/cart",
        title: "Cart",
        elements: [],
        snapshotId: "snap-1",
      }));
      const browser = stubBrowser({ open, snapshot });

      const transcript = await runBrowseTaskLoop(
        "go to https://shop.example.com/checkout and finish the order",
        12,
        browser
      );

      expect(open).not.toHaveBeenCalled();
      expect(transcript.status).toBe("done");
    });

    it("does not navigate (and does not re-snapshot) when the goal names no URL and a tab is already open — reuses the probe as the loop's first snapshot (finding #7)", async () => {
      stubFetchSequence([{ outcome: "done", confidence: 1, model: "jev" }]);
      const open = vi.fn(async () => ({}));
      let snapshotCalls = 0;
      const snapshot = vi.fn(async () => {
        snapshotCalls++;
        return {
          url: "https://shop.example.com/cart",
          title: "Cart",
          elements: [],
          snapshotId: "snap-1",
        };
      });
      const browser = stubBrowser({ open, snapshot });

      const transcript = await runBrowseTaskLoop("accept the cookie banner", 12, browser);

      expect(open).not.toHaveBeenCalled();
      expect(transcript.status).toBe("done");
      // Exactly one snapshot call: the pre-loop probe, reused directly as
      // the loop's first iteration snapshot rather than re-taken.
      expect(snapshotCalls).toBe(1);
    });
  });

  // Requirement 2: never re-type into the same search-like field twice in a
  // row — press Enter instead. Bench finding B: Jev re-typed the identical
  // query into the search box three times in a row and never submitted it.
  describe("TYPE_TEXT-dedup rule for search-like fields (requirement 2)", () => {
    function searchBoxSnapshot(): SnapshotResult {
      return {
        url: "https://shop.example.com",
        title: "Shop",
        elements: [{ index: 0, tag: "input", role: "searchbox", label: "Search products", ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
    }

    it("overrides a repeat TYPE_TEXT into the same search-like element to PRESS_ENTER, tagged via:\"rule\"", async () => {
      let stepCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          stepCalls++;
          return {
            ok: true,
            json: async () => {
              if (stepCalls <= 2) {
                // Jev keeps deciding to type the same text into the same
                // field again — exactly the bench-B pattern.
                return {
                  outcome: "act",
                  operation: "TYPE_TEXT",
                  index: 0,
                  text: "headphones",
                  confidence: 0.9,
                  model: "jev",
                };
              }
              return { outcome: "done", confidence: 1, model: "jev" };
            },
          };
        })
      );

      const act = vi.fn(async () => ({}));
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ act, perform, snapshot: async () => searchBoxSnapshot() });
      const transcript = await runBrowseTaskLoop("search this site for headphones", 12, browser);

      expect(perform).toHaveBeenCalledTimes(1); // only the FIRST TYPE_TEXT actually lands
      expect(act).toHaveBeenCalledTimes(1); // the SECOND decision is overridden to PRESS_ENTER
      expect(act).toHaveBeenCalledWith({ action: "press", key: "Enter" });
      expect(transcript.steps[0]).toMatchObject({ operation: "TYPE_TEXT", ok: true });
      expect(transcript.steps[0].label).toContain('TYPE_TEXT "headphones" into "Search products"');
      expect(transcript.steps[1]).toMatchObject({ operation: "PRESS_ENTER", ok: true, via: "rule" });
    });

    it("does NOT override a repeat TYPE_TEXT into a non-search-like element", async () => {
      let stepCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          stepCalls++;
          return {
            ok: true,
            json: async () =>
              stepCalls <= 2
                ? { outcome: "act", operation: "TYPE_TEXT", index: 0, text: "John", confidence: 0.9, model: "jev" }
                : { outcome: "done", confidence: 1, model: "jev" },
          };
        })
      );

      const nameFieldSnapshot: SnapshotResult = {
        url: "https://shop.example.com",
        title: "Checkout",
        elements: [{ index: 0, tag: "input", label: "Full name", ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => nameFieldSnapshot });
      const transcript = await runBrowseTaskLoop("fill out the checkout form", 12, browser);

      expect(perform).toHaveBeenCalledTimes(2);
      expect(transcript.steps.every((s) => s.operation === "TYPE_TEXT")).toBe(true);
    });

    it("does NOT override to PRESS_ENTER when any element on the page isPassword, even into the same search-like field twice — mirrors the backend's hard credentials rule", async () => {
      let stepCalls = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          stepCalls++;
          return {
            ok: true,
            json: async () =>
              stepCalls <= 2
                ? {
                    outcome: "act",
                    operation: "TYPE_TEXT",
                    index: 0,
                    text: "headphones",
                    confidence: 0.9,
                    model: "jev",
                  }
                : { outcome: "done", confidence: 1, model: "jev" },
          };
        })
      );

      const searchBoxWithPasswordSnapshot: SnapshotResult = {
        url: "https://shop.example.com/login",
        title: "Login",
        elements: [
          { index: 0, tag: "input", role: "searchbox", label: "Search products", ops: ["TYPE_TEXT"] },
          { index: 1, tag: "input", label: "Password", isPassword: true, ops: ["TYPE_TEXT"] },
        ],
        snapshotId: "snap-1",
      };
      const act = vi.fn(async () => ({}));
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({
        act,
        perform,
        snapshot: async () => searchBoxWithPasswordSnapshot,
      });
      const transcript = await runBrowseTaskLoop("search this site for headphones", 12, browser);

      // No PRESS_ENTER override — both decisions land as plain TYPE_TEXT.
      expect(act).not.toHaveBeenCalled();
      expect(perform).toHaveBeenCalledTimes(2);
      expect(transcript.steps.every((s) => s.operation === "TYPE_TEXT")).toBe(true);
    });
  });

  // Requirement 3/4: the backend's BROWSE_CASCADE_MODEL cascade is surfaced to
  // the transcript as `via: "cascade"`, and to a terminal reason as
  // "(via cascade)".
  describe("cascade surfaced in the transcript (requirement 3/4)", () => {
    it("tags a cascade-decided act step with via:\"cascade\"", async () => {
      stubFetchSequence([
        {
          outcome: "act",
          operation: "CLICK",
          index: 0,
          confidence: 0.7,
          model: "openrouter:deepseek/deepseek-v4.1-flash",
          cascade: true,
        },
        DONE,
      ]);

      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform });
      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      expect(transcript.steps[0]).toMatchObject({ operation: "CLICK", ok: true, via: "cascade" });
    });

    it("does not tag an ordinary Jev-decided step with any `via`", async () => {
      stubFetchSequence([CLICK_STEP, DONE]);

      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform });
      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      expect(transcript.steps[0]).not.toHaveProperty("via");
    });

    it("marks a cascade-decided terminal done/blocked reason with \"(via cascade)\"", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => ({
          ok: true,
          json: async () => ({
            outcome: "done",
            confidence: 0.7,
            model: "openrouter:deepseek/deepseek-v4.1-flash",
            reason: "cart already has the item",
            cascade: true,
          }),
        }))
      );

      const browser = stubBrowser({});
      const transcript = await runBrowseTaskLoop("add headphones to cart", 12, browser);

      expect(transcript.status).toBe("done");
      expect(transcript.reason).toBe("cart already has the item (via cascade)");
    });
  });

  // Finding #6: a URL embedded in prose commonly picks up trailing
  // punctuation that isn't part of the URL — must be stripped, but a
  // legitimately balanced trailing paren (e.g. a Wikipedia-style link) must
  // survive.
  describe("extractUrlFromGoal (finding #6)", () => {
    it("strips a trailing comma", () => {
      expect(extractUrlFromGoal("go to https://example.com/a, then search")).toBe(
        "https://example.com/a"
      );
    });

    it("strips a trailing period", () => {
      expect(extractUrlFromGoal("see https://example.com/a.")).toBe("https://example.com/a");
    });

    it("strips a trailing semicolon", () => {
      expect(extractUrlFromGoal("open https://example.com/a; do the thing")).toBe(
        "https://example.com/a"
      );
    });

    it("strips a trailing exclamation mark", () => {
      expect(extractUrlFromGoal("go to https://example.com/a!")).toBe("https://example.com/a");
    });

    it("strips an unbalanced trailing closing bracket", () => {
      expect(extractUrlFromGoal("see [https://example.com/a]")).toBe("https://example.com/a");
    });

    it("strips an unbalanced trailing closing brace", () => {
      expect(extractUrlFromGoal("see {https://example.com/a}")).toBe("https://example.com/a");
    });

    it("strips an unbalanced trailing closing paren", () => {
      expect(extractUrlFromGoal("see (https://example.com/a)")).toBe("https://example.com/a");
    });

    it("strips a trailing closing quote", () => {
      expect(extractUrlFromGoal("go to 'https://example.com/a' now")).toBe(
        "https://example.com/a"
      );
    });

    it("keeps a BALANCED trailing paren that is genuinely part of the URL", () => {
      expect(extractUrlFromGoal("see https://en.wikipedia.org/wiki/Foo_(bar) for details")).toBe(
        "https://en.wikipedia.org/wiki/Foo_(bar)"
      );
    });

    it("strips multiple trailing punctuation characters in one pass", () => {
      expect(extractUrlFromGoal("open https://example.com/a)., please")).toBe(
        "https://example.com/a"
      );
    });

    it("returns undefined when no URL is present", () => {
      expect(extractUrlFromGoal("just search this page")).toBeUndefined();
    });
  });

  describe("action cache", () => {
    // Builds a {labelHash, tag, role?} target the way the real write path
    // does (actionCache.ts's `hashCachedLabel`) — a cache entry never
    // persists a target's raw label, only its hash.
    const cachedTarget = (label: string, tag: string, role?: string) => ({
      labelHash: hashCachedLabel(label),
      tag,
      ...(role ? { role } : {}),
    });

    const cacheKeyFor = (goal: string, history: Array<{ operation: string; label: string }> = []) =>
      buildStepCacheKey(goal, EXAMPLE_SNAPSHOT.url, EXAMPLE_SNAPSHOT.title, EXAMPLE_SNAPSHOT.elements, history);

    it("replays a cached CLICK without ever calling /api/browse/step, tagged via:\"cache\"", async () => {
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform });

      const transcript = await runBrowseTaskLoop("accept cookies", 1, browser);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(perform).toHaveBeenCalledTimes(1);
      expect(perform).toHaveBeenCalledWith({ snapshotId: "snap-1", operation: "CLICK", text: undefined, index: 0 });
      expect(transcript.cacheHits).toBe(1);
      expect(transcript.steps).toEqual([
        { operation: "CLICK", label: "Accept all", ok: true, index: 0, via: "cache" },
      ]);
    });

    it("replays a cached TYPE_TEXT by reading the text back out of the goal via textRange, and persists neither the typed text nor the target label", async () => {
      const goal = 'search for "wireless headphones" under $50';
      const searchSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 0, tag: "input", label: "Search", ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      const key = buildStepCacheKey(goal, searchSnapshot.url, searchSnapshot.title, searchSnapshot.elements, []);
      const textStart = goal.indexOf("wireless headphones");
      writeStepCacheEntry(key, goal, searchSnapshot.elements, {
        operation: "TYPE_TEXT",
        target: cachedTarget("Search", "input"),
        textRange: [textStart, textStart + "wireless headphones".length],
      });

      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      let receivedText: unknown;
      const perform = vi.fn(async (args: { text?: string }) => {
        receivedText = args.text;
        return {};
      });
      const browser = stubBrowser({ perform, snapshot: async () => searchSnapshot });

      await runBrowseTaskLoop(goal, 1, browser);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(receivedText).toBe("wireless headphones");
      // Nothing about the actual localStorage-persisted entry carries the
      // raw text — only the offset used to derive it above — and nothing
      // carries the raw target label either, only its hash.
      const raw = localStorage.getItem(ACTION_CACHE_STORAGE_KEY) ?? "";
      expect(raw).not.toContain("wireless headphones");
      expect(raw).not.toContain("Search");
    });

    it("self-heals when the cached element no longer resolves uniquely: deletes the entry and falls back to Jev without an extra snapshot", async () => {
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Gone now", "button"),
      });

      stubFetchSequence([DONE]);
      const perform = vi.fn(async () => ({}));
      const snapshot = vi.fn(async () => EXAMPLE_SNAPSHOT);
      const browser = stubBrowser({ perform, snapshot });

      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      expect(perform).not.toHaveBeenCalled(); // no unique match — never even attempted
      expect(transcript.status).toBe("done");
      expect(transcript.cacheHits).toBe(0);
      expect(transcript.steps).toEqual([]); // the miss itself is not recorded as a step
      expect(lookupStepCache(key, "accept cookies", EXAMPLE_SNAPSHOT.elements)).toBeUndefined();
      // No attempt was dispatched, so nothing may have changed — the SAME
      // snapshot this iteration already took is reused, not re-fetched.
      expect(snapshot).toHaveBeenCalledTimes(1);
    });

    it("self-heals when the cached action lands with no effect: deletes the entry, RECORDS a failed step, and takes a FRESH snapshot before falling back to Jev", async () => {
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });

      stubFetchSequence([DONE]);
      const perform = vi.fn(async () => ({ changed: false }));
      const snapshot = vi.fn(async () => EXAMPLE_SNAPSHOT);
      const browser = stubBrowser({ perform, snapshot });

      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      expect(perform).toHaveBeenCalledTimes(1); // the replay attempt itself did run
      expect(transcript.status).toBe("done");
      expect(transcript.steps).toEqual([
        { operation: "CLICK", label: "cache replay failed: (no effect)", ok: false, index: 0, via: "cache" },
      ]);
      expect(lookupStepCache(key, "accept cookies", EXAMPLE_SNAPSHOT.elements)).toBeUndefined();
      // The dispatched-but-failed replay may have altered the page — a
      // fresh snapshot is taken (this iteration's own + one more for the
      // next loop iteration) rather than trusting the stale one.
      expect(snapshot).toHaveBeenCalledTimes(2);
    });

    it("self-heals when the cached action is rejected by the bridge, and records why", async () => {
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });

      stubFetchSequence([DONE]);
      const perform = vi.fn(async () => ({ error: "target is gone or occluded" }));
      const browser = stubBrowser({ perform });

      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      expect(transcript.status).toBe("done");
      expect(transcript.steps).toEqual([
        {
          operation: "CLICK",
          label: "cache replay failed: target is gone or occluded",
          ok: false,
          index: 0,
          via: "cache",
        },
      ]);
      expect(lookupStepCache(key, "accept cookies", EXAMPLE_SNAPSHOT.elements)).toBeUndefined();
    });

    it("a failed cache replay is visible to the NEXT /api/browse/step call's history", async () => {
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });

      // The cache replay attempt itself never calls fetch — the first (and,
      // since Jev then returns "done", only) /api/browse/step call is the
      // one whose body must already carry the failed replay in `history`.
      let requestBody: unknown;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          requestBody = JSON.parse(init.body as string);
          return { ok: true, json: async () => DONE };
        })
      );
      const perform = vi.fn(async () => ({ error: "target is gone or occluded" }));
      const browser = stubBrowser({ perform });

      await runBrowseTaskLoop("accept cookies", 12, browser);

      expect((requestBody as { history: unknown[] }).history).toEqual([
        { operation: "CLICK", label: "cache replay failed: target is gone or occluded", ok: false, index: 0 },
      ]);
    });

    it("writes a landed Jev-decided CLICK to the cache, replayable on a later identical run", async () => {
      stubFetchSequence([CLICK_STEP, DONE]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform });

      await runBrowseTaskLoop("accept cookies", 12, browser);

      const key = cacheKeyFor("accept cookies");
      expect(lookupStepCache(key, "accept cookies", EXAMPLE_SNAPSHOT.elements)).toEqual({
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });
    });

    it("never writes a CLICK on an irreversible/sensitive-sounding target label", async () => {
      const checkoutSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Cart",
        elements: [{ index: 0, tag: "button", label: "Place order", ops: ["CLICK"] }],
        snapshotId: "snap-1",
      };
      stubFetchSequence([
        { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" },
        DONE,
      ]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => checkoutSnapshot });

      await runBrowseTaskLoop("place the order", 12, browser);

      const key = buildStepCacheKey(
        "place the order",
        checkoutSnapshot.url,
        checkoutSnapshot.title,
        checkoutSnapshot.elements,
        []
      );
      expect(lookupStepCache(key, "place the order", checkoutSnapshot.elements)).toBeUndefined();
    });

    it("never writes TYPE_TEXT into a password field to the cache", async () => {
      const passwordSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Login",
        elements: [{ index: 0, tag: "input", label: "Password", isPassword: true, ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      stubFetchSequence([
        { outcome: "act", operation: "TYPE_TEXT", index: 0, text: "hunter2", confidence: 0.9, model: "jev" },
        DONE,
      ]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => passwordSnapshot });

      await runBrowseTaskLoop("log in with password hunter2", 12, browser);

      const key = buildStepCacheKey(
        "log in with password hunter2",
        passwordSnapshot.url,
        passwordSnapshot.title,
        passwordSnapshot.elements,
        []
      );
      expect(lookupStepCache(key, "log in with password hunter2", passwordSnapshot.elements)).toBeUndefined();
      const raw = localStorage.getItem(ACTION_CACHE_STORAGE_KEY) ?? "";
      expect(raw).not.toContain("hunter2");
    });

    it("never writes TYPE_TEXT/SELECT into an OTP/verification-code field even when it isn't flagged isPassword", async () => {
      const otpSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Verify",
        elements: [{ index: 0, tag: "input", label: "Verification code", ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      stubFetchSequence([
        { outcome: "act", operation: "TYPE_TEXT", index: 0, text: "123456", confidence: 0.9, model: "jev" },
        DONE,
      ]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => otpSnapshot });

      await runBrowseTaskLoop("enter code 123456", 12, browser);

      const key = buildStepCacheKey(
        "enter code 123456",
        otpSnapshot.url,
        otpSnapshot.title,
        otpSnapshot.elements,
        []
      );
      expect(lookupStepCache(key, "enter code 123456", otpSnapshot.elements)).toBeUndefined();
    });

    it("never writes card-number-shaped TYPE_TEXT text to the cache", async () => {
      const fieldSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Checkout",
        elements: [{ index: 0, tag: "input", label: "Promo code", ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      stubFetchSequence([
        {
          outcome: "act",
          operation: "TYPE_TEXT",
          index: 0,
          text: "4111 1111 1111 1111",
          confidence: 0.9,
          model: "jev",
        },
        DONE,
      ]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => fieldSnapshot });

      await runBrowseTaskLoop("check out with card 4111 1111 1111 1111", 12, browser);

      const key = buildStepCacheKey(
        "check out with card 4111 1111 1111 1111",
        fieldSnapshot.url,
        fieldSnapshot.title,
        fieldSnapshot.elements,
        []
      );
      expect(
        lookupStepCache(key, "check out with card 4111 1111 1111 1111", fieldSnapshot.elements)
      ).toBeUndefined();
    });

    it("never writes a TYPE_TEXT step whose text does not occur verbatim in the goal", async () => {
      const searchSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Shop",
        elements: [{ index: 0, tag: "input", label: "Search", ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      // Jev's chosen text ("wireless earbuds") is a paraphrase, not a
      // substring of the goal itself — nothing to store an offset into.
      stubFetchSequence([
        {
          outcome: "act",
          operation: "TYPE_TEXT",
          index: 0,
          text: "wireless earbuds",
          confidence: 0.9,
          model: "jev",
        },
        DONE,
      ]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => searchSnapshot });

      await runBrowseTaskLoop("find me some cheap earphones", 12, browser);

      const key = buildStepCacheKey(
        "find me some cheap earphones",
        searchSnapshot.url,
        searchSnapshot.title,
        searchSnapshot.elements,
        []
      );
      expect(lookupStepCache(key, "find me some cheap earphones", searchSnapshot.elements)).toBeUndefined();
    });

    it("REPLAY-time re-check: refuses a cached TYPE_TEXT whose fresh resolved element is now a password field, even though the fingerprint still matches", async () => {
      // A field with the SAME label/tag the entry was written against, but
      // now flagged isPassword — simulates the page having changed what
      // that label/tag combination actually is.
      const nowPasswordSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Login",
        elements: [{ index: 0, tag: "input", label: "Field", isPassword: true, ops: ["TYPE_TEXT"] }],
        snapshotId: "snap-1",
      };
      const key = buildStepCacheKey(
        "log in",
        nowPasswordSnapshot.url,
        nowPasswordSnapshot.title,
        nowPasswordSnapshot.elements,
        []
      );
      writeStepCacheEntry(key, "log in", nowPasswordSnapshot.elements, {
        operation: "TYPE_TEXT",
        target: cachedTarget("Field", "input"),
        textRange: [0, 6],
      });
      stubFetchSequence([DONE]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform, snapshot: async () => nowPasswordSnapshot });

      const transcript = await runBrowseTaskLoop("log in", 12, browser);

      expect(perform).not.toHaveBeenCalled(); // treated as a miss, never attempted
      expect(transcript.status).toBe("done");
      expect(lookupStepCache(key, "log in", nowPasswordSnapshot.elements)).toBeUndefined();
    });

    it("REPLAY-time re-check: refuses a cached CLICK whose target label is irreversible-sounding, even though the fingerprint still matches", async () => {
      // A hand-written entry (bypassing the write-time guard entirely) —
      // stands in for an entry written before this guard existed, or one
      // written under a since-relaxed rule. The fresh snapshot's element
      // matches it uniquely by label+tag, so this exercises the REPLAY-time
      // re-check specifically, not the write-time one.
      const dangerousSnapshot: SnapshotResult = {
        url: "https://example.com",
        title: "Cart",
        elements: [{ index: 0, tag: "button", label: "Delete", ops: ["CLICK"] }],
        snapshotId: "snap-1",
      };
      const key = buildStepCacheKey(
        "clear the cart",
        dangerousSnapshot.url,
        dangerousSnapshot.title,
        dangerousSnapshot.elements,
        []
      );
      writeStepCacheEntry(key, "clear the cart", dangerousSnapshot.elements, {
        operation: "CLICK",
        target: cachedTarget("Delete", "button"),
      });
      const perform = vi.fn(async () => ({}));
      stubFetchSequence([DONE]);
      const browser = stubBrowser({ perform, snapshot: async () => dangerousSnapshot });

      const transcript = await runBrowseTaskLoop("clear the cart", 12, browser);

      expect(perform).not.toHaveBeenCalled(); // treated as a miss, never attempted
      expect(transcript.cacheHits).toBe(0);
      expect(lookupStepCache(key, "clear the cart", dangerousSnapshot.elements)).toBeUndefined();
    });

    it("never replays or writes WAIT", async () => {
      stubFetchSequence([{ outcome: "act", operation: "WAIT", confidence: 0.9, model: "jev" }, DONE]);
      const sleep = vi.fn(async () => {});
      const browser = stubBrowser({});

      const transcript = await runBrowseTaskLoop("wait for the page to load", 12, browser, undefined, sleep);

      const key = cacheKeyFor("wait for the page to load");
      expect(lookupStepCache(key, "wait for the page to load", EXAMPLE_SNAPSHOT.elements)).toBeUndefined();
      expect(transcript.cacheHits).toBe(0);
    });

    it("does not consult or write the cache when the kill switch is set", async () => {
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });
      localStorage.setItem(ACTION_CACHE_KILL_SWITCH_KEY, "off");

      stubFetchSequence([CLICK_STEP, DONE]);
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ perform });

      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      // The pre-existing entry was never consulted (the loop went through
      // the ordinary Jev decision instead), and no cacheHits were recorded.
      expect(transcript.status).toBe("done");
      expect(transcript.cacheHits).toBe(0);
      expect(transcript.steps[0]).not.toHaveProperty("via");
    });

    it("no fixed point: the same page+goal never re-hits a stale entry, since history grows on every step", async () => {
      // Regression for the code-review finding: the OLD key only hashed
      // goal+host+path-pattern+last-3-history-entries, so a target that
      // kept landing "no effect" against the SAME page could re-derive the
      // exact same key forever. The new key folds in the FULL history, so
      // even a run that keeps failing against the same page/goal mints a
      // new key every single step.
      const key = cacheKeyFor("accept cookies");
      writeStepCacheEntry(key, "accept cookies", EXAMPLE_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });

      stubFetchSequence([DONE]);
      // Every replay attempt fails the same way — if the key ever repeated,
      // this would loop forever re-hitting (and re-failing) the cache.
      const perform = vi.fn(async () => ({ error: "still gone" }));
      const browser = stubBrowser({ perform });

      const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

      // Exactly ONE cache attempt: after the first failed replay, the key
      // for the next iteration's (now longer) history no longer matches
      // anything in the store, so it falls straight through to Jev.
      expect(perform).toHaveBeenCalledTimes(1);
      expect(transcript.status).toBe("done");
    });

    // Code review item 5: a cache replay is just as real a "something
    // landed" step as an ordinary Jev/cascade/rule decision — the same-url
    // WAIT streak must reset after one, not just after a non-cached
    // decision (browseTask.ts's existing `sameUrlWaitStreak = 0` reset for
    // a landed non-WAIT decision).
    it("resets the same-url WAIT streak after a successful cache replay, same as any other non-WAIT decision", async () => {
      const FIXED_URL_SNAPSHOT: SnapshotResult = {
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 0, tag: "button", label: "Accept all", ops: ["CLICK"] }],
        snapshotId: "snap-fixed",
      };
      const goal = "wait around a cached click";

      // The cache entry is written for the EXACT state after two landed
      // WAITs — the history a real run would have reached by step 3.
      const historyAfterTwoWaits = [
        { operation: "WAIT", label: "waiting for the page to settle" },
        { operation: "WAIT", label: "waiting for the page to settle" },
      ];
      const key = buildStepCacheKey(
        goal,
        FIXED_URL_SNAPSHOT.url,
        FIXED_URL_SNAPSHOT.title,
        FIXED_URL_SNAPSHOT.elements,
        historyAfterTwoWaits
      );
      writeStepCacheEntry(key, goal, FIXED_URL_SNAPSHOT.elements, {
        operation: "CLICK",
        target: cachedTarget("Accept all", "button"),
      });

      // Only 5 real /api/browse/step calls: step 3 (the CLICK) is served
      // entirely from the cache and never calls fetch at all.
      stubFetchSequence([
        { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" },
        { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" },
        { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" },
        { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" },
        { outcome: "act", operation: "WAIT", confidence: 0.5, model: "jev" },
      ]);

      const snapshot = vi.fn(async () => FIXED_URL_SNAPSHOT);
      const sleep = vi.fn(async () => {});
      const perform = vi.fn(async () => ({}));
      const browser = stubBrowser({ snapshot, perform });

      const transcript = await runBrowseTaskLoop(goal, 6, browser, undefined, sleep);

      // If the reset did NOT happen, the streak from the first two WAITs
      // would carry straight through the cache replay and the very next
      // WAIT (step 4) would already be the 3rd of an unbroken streak,
      // stalling the loop long before 6 steps. Reaching all 6 steps with 4
      // total sleeps (2 before the cache hit, 2 fresh ones after it) is
      // only possible if the streak was reset.
      expect(transcript.status).toBe("budget");
      expect(sleep).toHaveBeenCalledTimes(4);
      expect(transcript.cacheHits).toBe(1);
      expect(transcript.steps.map((step) => `${step.operation}:${step.ok}`)).toEqual([
        "WAIT:true",
        "WAIT:true",
        "CLICK:true",
        "WAIT:true",
        "WAIT:true",
        "WAIT:false",
      ]);
    });
  });
});
