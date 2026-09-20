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
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls === 1
              ? { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }
              : {
                  outcome: "done",
                  confidence: 1,
                  model: "jev",
                  reason: "cookie banner dismissed",
                },
        };
      })
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          outcome: "blocked",
          confidence: 0.2,
          model: "jev",
          reason: "confidence below threshold",
        }),
      }))
    );

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
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls === 1
              ? { outcome: "retry", confidence: 0.4, model: "jev", reason: "no candidate element" }
              : { outcome: "done", confidence: 1, model: "jev", reason: "goal met" },
        };
      })
    );

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
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls === 1
              ? { operation: "CLICK", index: 0, confidence: 0.9, model: "jev" } // no `outcome` at all
              : { outcome: "some_future_value", confidence: 0.9, model: "jev" },
        };
      })
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ outcome: "act", operation: "SCROLL_DOWN", confidence: 0.9, model: "jev" }),
      }))
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ outcome: "act", operation: "CLICK", confidence: 0.9, model: "jev" }),
      }))
    );

    const perform = vi.fn(async () => ({}));
    const browser = stubBrowser({ perform });
    const transcript = await runBrowseTaskLoop("click something", 1, browser);

    expect(perform).not.toHaveBeenCalled();
    expect(transcript.steps).toEqual([
      { operation: "CLICK", label: "missing index for a non-scroll operation", ok: false },
    ]);
  });

  it("stops at maxSteps when the loop never resolves outcome:done/blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }),
      }))
    );

    const browser = stubBrowser({});
    const transcript = await runBrowseTaskLoop("wander forever", 3, browser);

    expect(transcript.status).toBe("budget");
    expect(transcript.reason).toBe("maxSteps reached");
    expect(transcript.steps).toHaveLength(3);
  });

  it("caps maxSteps at the hard cap of 25 even when a larger value is requested", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }),
      }))
    );

    const browser = stubBrowser({});
    const transcript = await runBrowseTaskLoop("wander forever", 1000, browser);

    expect(transcript.steps).toHaveLength(25);
  });

  it("stops once the deadline is reached, before maxSteps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }),
      }))
    );

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
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls === 1
              ? { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }
              : { outcome: "done", confidence: 1, model: "jev" },
        };
      })
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ outcome: "done", confidence: 1, model: "jev" }),
      }))
    );

    const browser = stubBrowser({ snapshot });
    const transcript = await runBrowseTaskLoop("accept cookies", 12, browser);

    expect(transcript.status).toBe("done");
    expect(transcript.steps).toEqual([
      { operation: "SNAPSHOT", label: "page navigating", ok: false },
    ]);
  });

  it("forwards goal and maxSteps from args and returns a real JSON string", async () => {
    let receivedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        receivedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          json: async () => ({ outcome: "done", confidence: 1, model: "jev" }),
        };
      })
    );

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
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls === 1
              ? { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }
              : { outcome: "done", confidence: 1, model: "jev" },
        };
      })
    );

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
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

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
    let stepCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        stepCalls++;
        return {
          ok: true,
          json: async () =>
            stepCalls >= 6
              ? { outcome: "done", confidence: 1, model: "jev" }
              : { outcome: "act", operation: "CLICK", index: 0, confidence: 0.9, model: "jev" },
        };
      })
    );

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

  it("surfaces a snapshot that resolved with { error } instead of reporting it as malformed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ outcome: "done", confidence: 1, model: "jev" }),
      }))
    );

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
