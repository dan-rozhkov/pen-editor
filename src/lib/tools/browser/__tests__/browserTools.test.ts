import { afterEach, describe, expect, it, vi } from "vitest";
import { browseOpen } from "@/lib/tools/browser/browseOpen";
import { browseAct, runActionsBatch } from "@/lib/tools/browser/browseAct";
import { browseFindImages } from "@/lib/tools/browser/browseFindImages";
import { browseRead } from "@/lib/tools/browser/browseRead";
import { browseSnapshot } from "@/lib/tools/browser/browseSnapshot";
import { browseScreenshot } from "@/lib/tools/browser/browseScreenshot";
import { browseTabs } from "@/lib/tools/browser/browseTabs";
import {
  BROWSER_BRIDGE_METHOD_MISSING_ERROR,
  BROWSER_NOT_AVAILABLE_ERROR,
} from "@/lib/tools/browser/shared";
import { setPenDesktop, stubBrowser, stubLocateFetch, type PenDesktopBrowser } from "./helpers";

afterEach(() => {
  delete window.penDesktop;
  vi.unstubAllGlobals();
});

describe("browse_open", () => {
  it("forwards args to window.penDesktop.browser.open and returns the result", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        open: async (args) => {
          received = args;
          return { url: "https://pinterest.com/search?q=modern%20kitchen", title: "Pinterest" };
        },
      }));

    const result = JSON.parse(await browseOpen({ url: "https://pinterest.com/search?q=modern kitchen" }));

    expect(received).toEqual({ url: "https://pinterest.com/search?q=modern kitchen" });
    expect(result).toEqual({
      url: "https://pinterest.com/search?q=modern%20kitchen",
      title: "Pinterest",
    });
  });

  it("returns the documented error when window.penDesktop.browser is absent (web build)", async () => {
    expect(window.penDesktop).toBeUndefined();

    const result = JSON.parse(await browseOpen({ url: "https://pinterest.com" }));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error, never throwing", async () => {
    setPenDesktop(stubBrowser({
        open: async () => {
          throw new Error("browser:command timed out");
        },
      }));

    const result = JSON.parse(await browseOpen({ url: "https://pinterest.com" }));

    expect(result).toEqual({ error: "browser:command timed out" });
  });

  // The bridge's declared return type is Promise<unknown>, which permits
  // undefined. JSON.stringify(undefined) is the value `undefined`, not a
  // string — ToolHandler's Promise<string> contract requires a real string,
  // and executeToolCall calling .startsWith on a non-string throws a
  // TypeError that masks the real (empty) result as a bogus error.
  it("returns a real JSON string, not the value undefined, when the bridge resolves undefined", async () => {
    setPenDesktop(stubBrowser({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        open: async () => undefined as any,
      }));

    const result = await browseOpen({ url: "https://pinterest.com" });

    expect(typeof result).toBe("string");
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({});
  });
});

describe("browse_act", () => {
  it("forwards args to window.penDesktop.browser.act and returns the result", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        act: async (args) => {
          received = args;
          return { url: "https://pinterest.com", title: "Pinterest", matched: "Search" };
        },
      }));

    const result = JSON.parse(await browseAct({ action: "click", target: "Search" }));

    expect(received).toEqual({ action: "click", target: "Search" });
    expect(result).toEqual({ url: "https://pinterest.com", title: "Pinterest", matched: "Search" });
  });

  it("returns the documented error when window.penDesktop.browser is absent", async () => {
    const result = JSON.parse(await browseAct({ action: "scroll", amount: 1 }));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    setPenDesktop(stubBrowser({
        act: async () => {
          throw new Error("no browser tab open");
        },
      }));

    const result = JSON.parse(await browseAct({ action: "back" }));

    expect(result).toEqual({ error: "no browser tab open" });
  });

  // Full browser use (docs/superpowers/specs/
  // 2026-09-23-full-browser-use-design.md) widens `act`'s argument shape —
  // index targeting, press/hover/select/reload/wait. browseAct is a thin,
  // untyped forwarder, so every new field must reach the bridge untouched.
  it("forwards index/snapshotId/key/ms and the new action values untouched", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        act: async (args) => {
          received = args;
          return { found: true };
        },
      }));

    const args = {
      action: "press",
      index: 3,
      snapshotId: "snap-1",
      key: "Enter",
      ms: 5000,
      text: "hello",
    };
    await browseAct(args);
    expect(received).toEqual(args);

    for (const action of ["hover", "select", "reload", "wait"]) {
      received = undefined;
      await browseAct({ action, index: 1, snapshotId: "snap-1" });
      expect(received).toEqual({ action, index: 1, snapshotId: "snap-1" });
    }
  });
});

describe("browse_act element targeting", () => {
  function stubSnapshotBrowser(overrides: Partial<PenDesktopBrowser> = {}): PenDesktopBrowser {
    return stubBrowser({
      snapshot: async () => ({
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 2, tag: "button", label: "Search", ops: ["CLICK"] }],
        snapshotId: "snap-1",
      }),
      ...overrides,
    });
  }

  it("resolves `element` via snapshot + /api/browse/locate, then calls act with index+snapshotId and without element/target", async () => {
    let receivedUrl: string | undefined;
    let receivedBody: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        receivedUrl = url;
        receivedBody = JSON.parse(init.body as string);
        return {
          ok: true,
          status: 200,
          json: async () => ({ outcome: "found", index: 2, label: "Search", confidence: 0.87, model: "jev" }),
        };
      })
    );

    let receivedActArgs: unknown;
    setPenDesktop(stubSnapshotBrowser({
        act: async (args) => {
          receivedActArgs = args;
          return { url: "https://example.com", title: "Example", matched: "Search" };
        },
      }));

    const result = JSON.parse(
      await browseAct({ action: "click", element: "the search button in the header" })
    );

    expect(receivedUrl).toContain("/api/browse/locate");
    expect(receivedBody).toEqual({
      description: "the search button in the header",
      operation: "CLICK",
      url: "https://example.com",
      title: "Example",
      elements: [{ index: 2, tag: "button", label: "Search", ops: ["CLICK"] }],
    });
    expect(receivedActArgs).toEqual({ action: "click", index: 2, snapshotId: "snap-1" });
    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      matched: "Search",
      // `resolved.snapshotId` is REMOVED (browse-speed-contract.md, "Frontend"
      // item 1): maybeAttachSnapshot below takes yet another fresh snapshot
      // and attaches it as `snapshot`, making the id resolveByElement put on
      // `resolved` a step stale — the note now points at `snapshot.snapshotId`
      // instead of repeating a (possibly stale) id of its own.
      resolved: {
        index: 2,
        label: "Search",
        confidence: 0.87,
        note: expect.stringContaining("snap-1"),
      },
      // No `changed` field on this bridge stub's act result, so
      // maybeAttachSnapshot treats it as "may have changed" and attaches a
      // fresh snapshot (browse-speed-contract.md, "Frontend" item 2) — the
      // bridge's `snapshot()` stub here (stubSnapshotBrowser) returns a
      // valid shape, unlike the other suites' default `{}` stub.
      snapshot: {
        url: "https://example.com",
        title: "Example",
        elements: [{ index: 2, tag: "button", label: "Search", ops: ["CLICK"] }],
        snapshotId: "snap-1",
      },
    });
  });

  it("includes `resolved` (with the fresh snapshotId) on an error result when the act itself fails after a successful locate", async () => {
    stubLocateFetch({ outcome: "found", index: 2, label: "Search", confidence: 0.9, model: "jev" });

    setPenDesktop(stubSnapshotBrowser({
        act: async () => {
          throw new Error("target is gone or occluded");
        },
      }));

    const result = JSON.parse(
      await browseAct({ action: "click", element: "the search button in the header" })
    );

    expect(result.error).toBe("target is gone or occluded");
    // An error result has no `changed` field either, so maybeAttachSnapshot
    // still takes another fresh snapshot and attaches it — `resolved`'s own
    // snapshotId is stripped in favor of it, same as the success case above.
    expect(result.snapshot).toEqual({
      url: "https://example.com",
      title: "Example",
      elements: [{ index: 2, tag: "button", label: "Search", ops: ["CLICK"] }],
      snapshotId: "snap-1",
    });
    expect(result.resolved).toEqual({
      index: 2,
      label: "Search",
      confidence: 0.9,
      note: expect.stringContaining("snap-1"),
    });
  });

  it("maps action to the locate operation vocabulary (type/select/hover/press)", async () => {
    const receivedOperations: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        receivedOperations.push((JSON.parse(init.body as string) as { operation: string }).operation);
        return {
          ok: true,
          status: 200,
          json: async () => ({ outcome: "found", index: 2, label: "Search", confidence: 0.9, model: "jev" }),
        };
      })
    );

    setPenDesktop(stubSnapshotBrowser({ act: async () => ({}) }));

    await browseAct({ action: "type", element: "the search box", text: "hello" });
    await browseAct({ action: "select", element: "the country dropdown", text: "Canada" });
    await browseAct({ action: "hover", element: "the menu item" });
    await browseAct({ action: "press", element: "the email field", key: "Enter" });

    // press resolves as FOCUS, not CLICK — see ACTION_TO_LOCATE_OPERATION's
    // comment: FOCUS accepts any of CLICK/TYPE_TEXT/SELECT as a candidate,
    // so Enter can be resolved onto a text input, not just a button.
    expect(receivedOperations).toEqual(["TYPE_TEXT", "SELECT", "HOVER", "FOCUS"]);
  });

  it("rejects a type/select element call missing `text`, and a press call missing `key`, without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    setPenDesktop(stubSnapshotBrowser());

    const typeResult = JSON.parse(await browseAct({ action: "type", element: "the search box" }));
    const selectResult = JSON.parse(
      await browseAct({ action: "select", element: "the country dropdown" })
    );
    const pressResult = JSON.parse(await browseAct({ action: "press", element: "the email field" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(typeResult.error).toMatch(/"text"/);
    expect(selectResult.error).toMatch(/"text"/);
    expect(pressResult.error).toMatch(/"key"/);
  });

  it("returns a 'no element matched' error naming target/index as the fallback when outcome is not_found", async () => {
    stubLocateFetch({ outcome: "not_found", reason: "no candidate matched the description" });

    const act = vi.fn(async () => ({}));
    setPenDesktop(stubSnapshotBrowser({ act }));

    const result = JSON.parse(await browseAct({ action: "click", element: "a purple elephant" }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/No element matched "a purple elephant"/);
    expect(result.error).toMatch(/no candidate matched the description/);
    expect(result.error).toMatch(/browse_snapshot/);
  });

  it.each([
    {
      name: "returns a clear error and does not call act when outcome is retry",
      setup: () => stubLocateFetch({ outcome: "retry", reason: "ambiguous, matched two candidates" }),
      extraMatch: /ambiguous, matched two candidates/,
    },
    {
      name: "returns a clear error when /api/browse/locate responds 503 (no fast model configured)",
      setup: () => stubLocateFetch({}, 503),
      extraMatch: /not available/i,
    },
    {
      name: "returns a clear error on a fetch failure resolving /api/browse/locate",
      setup: () =>
        vi.stubGlobal(
          "fetch",
          vi.fn(async () => {
            throw new Error("network down");
          })
        ),
      extraMatch: /network down/,
    },
  ])("$name", async ({ setup, extraMatch }) => {
    setup();

    const act = vi.fn(async () => ({}));
    setPenDesktop(stubSnapshotBrowser({ act }));

    const result = JSON.parse(await browseAct({ action: "click", element: "a button" }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(extraMatch);
    expect(result.error).toMatch(/target or index/i);
  });

  it("returns a clear error when the pre-locate snapshot resolves { error }, without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    setPenDesktop(stubBrowser({
        snapshot: async () => ({ error: "No browser tab is open — call browse_open first." }),
      }));

    const result = JSON.parse(await browseAct({ action: "click", element: "a button" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.error).toContain("No browser tab is open");
  });

  it("returns an error for an action that does not support `element` (e.g. scroll)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    setPenDesktop(stubSnapshotBrowser());

    const result = JSON.parse(await browseAct({ action: "scroll", amount: 1, element: "the page" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.error).toMatch(/element/i);
  });

  it("prefers an explicit index over `element` and never calls /api/browse/locate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let receivedActArgs: unknown;
    setPenDesktop(stubSnapshotBrowser({
        act: async (args) => {
          receivedActArgs = args;
          return { matched: "by index" };
        },
      }));

    await browseAct({ action: "click", index: 5, snapshotId: "snap-9", element: "the search button" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(receivedActArgs).toEqual({ action: "click", index: 5, snapshotId: "snap-9" });
  });

  it("prefers an explicit target over `element` and never calls /api/browse/locate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let receivedActArgs: unknown;
    setPenDesktop(stubSnapshotBrowser({
        act: async (args) => {
          receivedActArgs = args;
          return { matched: "Search" };
        },
      }));

    await browseAct({ action: "click", target: "Search", element: "the search button" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(receivedActArgs).toEqual({ action: "click", target: "Search" });
  });
});

describe("browse_snapshot", () => {
  it("forwards to window.penDesktop.browser.snapshot and returns the result", async () => {
    let called = false;
    setPenDesktop(stubBrowser({
        snapshot: async () => {
          called = true;
          return { snapshotId: "snap-1", elements: [{ index: 0, tag: "button", text: "Search" }] };
        },
      }));

    const result = JSON.parse(await browseSnapshot({}));

    expect(called).toBe(true);
    expect(result).toEqual({
      snapshotId: "snap-1",
      elements: [{ index: 0, tag: "button", text: "Search" }],
    });
  });

  it("returns the documented error when window.penDesktop.browser is absent", async () => {
    const result = JSON.parse(await browseSnapshot({}));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    setPenDesktop(stubBrowser({
        snapshot: async () => {
          throw new Error("no browser tab open");
        },
      }));

    const result = JSON.parse(await browseSnapshot({}));

    expect(result).toEqual({ error: "no browser tab open" });
  });
});

describe("browse_screenshot", () => {
  it("forwards args to window.penDesktop.browser.screenshot and returns the result", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        screenshot: async (args) => {
          received = args;
          return { imageData: "data:image/jpeg;base64,AAAA", width: 800, height: 600, url: "https://example.com", title: "Example" };
        },
      }));

    const result = JSON.parse(await browseScreenshot({ annotate: true }));

    expect(received).toEqual({ annotate: true });
    expect(result).toEqual({
      imageData: "data:image/jpeg;base64,AAAA",
      width: 800,
      height: 600,
      url: "https://example.com",
      title: "Example",
    });
  });

  it("returns the documented error when window.penDesktop.browser is absent (web build)", async () => {
    expect(window.penDesktop).toBeUndefined();

    const result = JSON.parse(await browseScreenshot({}));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("returns a 'needs a newer desktop app' error when the bridge exists but lacks .screenshot (older desktop app)", async () => {
    setPenDesktop(stubBrowser({}));
    expect(window.penDesktop!.browser?.screenshot).toBeUndefined();

    const result = JSON.parse(await browseScreenshot({}));

    expect(result).toEqual({ error: BROWSER_BRIDGE_METHOD_MISSING_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    setPenDesktop(stubBrowser({
        screenshot: async () => {
          throw new Error("capture failed");
        },
      }));

    const result = JSON.parse(await browseScreenshot({}));

    expect(result).toEqual({ error: "capture failed" });
  });
});

describe("browse_tabs", () => {
  it("forwards args to window.penDesktop.browser.tabs and returns the result", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        tabs: async (args) => {
          received = args;
          return {
            tabs: [{ tabId: "t1", url: "https://example.com", title: "Example", current: true }],
            current: "t1",
          };
        },
      }));

    const result = JSON.parse(await browseTabs({ action: "new", url: "https://example.com" }));

    expect(received).toEqual({ action: "new", url: "https://example.com" });
    expect(result.current).toBe("t1");
  });

  it("returns the documented error when window.penDesktop.browser is absent (web build)", async () => {
    expect(window.penDesktop).toBeUndefined();

    const result = JSON.parse(await browseTabs({ action: "list" }));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("returns a 'needs a newer desktop app' error when the bridge exists but lacks .tabs (older desktop app)", async () => {
    setPenDesktop(stubBrowser({}));
    expect(window.penDesktop!.browser?.tabs).toBeUndefined();

    const result = JSON.parse(await browseTabs({ action: "list" }));

    expect(result).toEqual({ error: BROWSER_BRIDGE_METHOD_MISSING_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    setPenDesktop(stubBrowser({
        tabs: async () => {
          throw new Error("no such tab");
        },
      }));

    const result = JSON.parse(await browseTabs({ action: "close", tabId: "t1" }));

    expect(result).toEqual({ error: "no such tab" });
  });
});

describe("browse_find_images", () => {
  it("forwards args to window.penDesktop.browser.findImages and returns the result", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        findImages: async (args) => {
          received = args;
          return {
            images: [{ url: "https://example.com/a.jpg", alt: "", width: 400, height: 300 }],
            count: 1,
            pageUrl: "https://pinterest.com",
          };
        },
      }));

    const result = JSON.parse(await browseFindImages({ minWidth: 200, minHeight: 200, limit: 30 }));

    expect(received).toEqual({ minWidth: 200, minHeight: 200, limit: 30 });
    expect(result.count).toBe(1);
    expect(result.images).toHaveLength(1);
  });

  it("returns the documented error when window.penDesktop.browser is absent", async () => {
    const result = JSON.parse(await browseFindImages({}));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    setPenDesktop(stubBrowser({
        findImages: async () => {
          throw new Error("page script threw");
        },
      }));

    const result = JSON.parse(await browseFindImages({}));

    expect(result).toEqual({ error: "page script threw" });
  });
});

describe("browse_read", () => {
  it("forwards args to window.penDesktop.browser.read and returns the result", async () => {
    let received: unknown;
    setPenDesktop(stubBrowser({
        read: async (args) => {
          received = args;
          return {
            url: "https://example.com",
            title: "Example",
            headings: ["Welcome"],
            text: "Example page body text.",
            links: [{ label: "About", href: "https://example.com/about" }],
            truncated: false,
          };
        },
      }));

    const result = JSON.parse(await browseRead({ maxChars: 4000 }));

    expect(received).toEqual({ maxChars: 4000 });
    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      headings: ["Welcome"],
      text: "Example page body text.",
      links: [{ label: "About", href: "https://example.com/about" }],
      truncated: false,
    });
  });

  it("returns the documented error when window.penDesktop.browser is absent", async () => {
    const result = JSON.parse(await browseRead({}));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    setPenDesktop(stubBrowser({
        read: async () => {
          throw new Error("no browser tab open");
        },
      }));

    const result = JSON.parse(await browseRead({ selector: "#missing" }));

    expect(result).toEqual({ error: "no browser tab open" });
  });
});

// Full browser use follow-up (browse-speed-contract.md, "Frontend" items 1
// and 2) — a `snapshot` field valid enough for `takeSnapshot`'s shape check
// to accept, used by the tests below to exercise the attach path. The
// suites above rely on the DEFAULT stub's `snapshot: async () => ({})`
// being invalid on purpose (see shared.ts's `isSnapshotResult`) so none of
// them accidentally pick up a `snapshot` field.
const VALID_SNAPSHOT = {
  url: "https://example.com",
  title: "Example",
  elements: [{ index: 0, tag: "button", label: "Search" }],
  snapshotId: "snap-fresh",
};

describe("browse_open snapshot attach", () => {
  it("attaches a fresh snapshot after a successful open", async () => {
    let snapshotCalls = 0;
    setPenDesktop(stubBrowser({
        open: async () => ({ url: "https://example.com", title: "Example" }),
        snapshot: async () => {
          snapshotCalls++;
          return VALID_SNAPSHOT;
        },
      }));

    const result = JSON.parse(await browseOpen({ url: "https://example.com" }));

    expect(snapshotCalls).toBe(1);
    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      snapshot: VALID_SNAPSHOT,
    });
  });

  it("does not attach a snapshot when the open itself failed", async () => {
    const snapshot = vi.fn(async () => VALID_SNAPSHOT);
    setPenDesktop(stubBrowser({
        open: async () => ({ error: "navigation timed out" }),
        snapshot,
      }));

    const result = JSON.parse(await browseOpen({ url: "https://example.com" }));

    expect(snapshot).not.toHaveBeenCalled();
    expect(result).toEqual({ error: "navigation timed out" });
  });

  it("does not fail the open when the follow-up snapshot itself fails", async () => {
    setPenDesktop(stubBrowser({
        open: async () => ({ url: "https://example.com", title: "Example" }),
        snapshot: async () => ({ error: "no browser tab open" }),
      }));

    const result = JSON.parse(await browseOpen({ url: "https://example.com" }));

    expect(result).toEqual({ url: "https://example.com", title: "Example" });
    expect(result.snapshot).toBeUndefined();
  });
});

describe("browse_act snapshot attach", () => {
  it("attaches a fresh snapshot when the act result reports changed !== false", async () => {
    setPenDesktop(stubBrowser({
        act: async () => ({ matched: "Search", changed: true }),
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(await browseAct({ action: "click", target: "Search" }));

    expect(result.snapshot).toEqual(VALID_SNAPSHOT);
  });

  it("does not attach a snapshot when the act result reports changed: false", async () => {
    const snapshot = vi.fn(async () => VALID_SNAPSHOT);
    setPenDesktop(stubBrowser({
        act: async () => ({ matched: "Search", changed: false }),
        snapshot,
      }));

    const result = JSON.parse(await browseAct({ action: "click", target: "Search" }));

    expect(snapshot).not.toHaveBeenCalled();
    expect(result.snapshot).toBeUndefined();
  });

  it("always attaches a snapshot for wait, even when changed is false", async () => {
    setPenDesktop(stubBrowser({
        act: async () => ({ changed: false }),
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(await browseAct({ action: "wait", ms: 500 }));

    expect(result.snapshot).toEqual(VALID_SNAPSHOT);
  });

  it("always attaches a snapshot for scroll, even when changed is false", async () => {
    setPenDesktop(stubBrowser({
        act: async () => ({ changed: false }),
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(await browseAct({ action: "scroll", amount: 1 }));

    expect(result.snapshot).toEqual(VALID_SNAPSHOT);
  });
});

describe("browse_act actions batch", () => {
  // Records every args object passed to act() and answers { matched: "ok",
  // changed: true } for each — the default "just tell me what was sent"
  // shape reused across most of this describe block's happy-path tests.
  function recordingActBrowser(overrides: Partial<PenDesktopBrowser> = {}) {
    const receivedActArgs: unknown[] = [];
    setPenDesktop(
      stubBrowser({
        act: async (args) => {
          receivedActArgs.push(args);
          return { matched: "ok", changed: true };
        },
        snapshot: async () => VALID_SNAPSHOT,
        ...overrides,
      })
    );
    return receivedActArgs;
  }

  it("runs actions sequentially, forwarding the top-level snapshotId to index-based entries", async () => {
    const receivedActArgs = recordingActBrowser();

    const result = JSON.parse(
      await browseAct({
        snapshotId: "snap-top",
        actions: [
          { action: "click", index: 0 },
          { action: "type", index: 1, text: "hello" },
        ],
      })
    );

    expect(receivedActArgs).toEqual([
      { action: "click", index: 0, snapshotId: "snap-top" },
      { action: "type", index: 1, text: "hello", snapshotId: "snap-top" },
    ]);
    expect(result.completed).toBe(2);
    expect(result.stoppedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
    expect(result.results).toHaveLength(2);
    expect(result.snapshot).toEqual(VALID_SNAPSHOT);
  });

  it("stops at the first entry that returns { error } and reports stoppedAt/completed", async () => {
    let callCount = 0;
    setPenDesktop(stubBrowser({
        act: async () => {
          callCount++;
          if (callCount === 2) {
            return { error: "target is gone or occluded" };
          }
          return { matched: "ok", changed: true };
        },
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(
      await browseAct({
        snapshotId: "snap-top",
        actions: [
          { action: "click", index: 0 },
          { action: "click", index: 1 },
          { action: "click", index: 2 },
        ],
      })
    );

    expect(callCount).toBe(2);
    expect(result.completed).toBe(1);
    expect(result.stoppedAt).toBe(1);
    expect(result.error).toBe("target is gone or occluded");
    expect(result.results).toHaveLength(2);
    // The final snapshot is still attempted even though the batch stopped
    // early — the model needs a fresh read of wherever the batch left off.
    expect(result.snapshot).toEqual(VALID_SNAPSHOT);
  });

  it("does not forward the top-level snapshotId to a targetless entry (e.g. press) — only entries carrying an index", async () => {
    // Finding: the desktop bridge's act() treats ANY snapshotId on the args
    // as "index mode" and rejects an entry with a snapshotId but no index.
    // [{type,index:3},{press,key:'Enter'}] used to fail at entry 1 because
    // the copied top-level snapshotId made the targetless press entry look
    // like an (invalid) index-mode call.
    const receivedActArgs = recordingActBrowser();

    const result = JSON.parse(
      await browseAct({
        snapshotId: "snap-top",
        actions: [
          { action: "type", index: 3, text: "hello" },
          { action: "press", key: "Enter" },
        ],
      })
    );

    expect(receivedActArgs).toEqual([
      { action: "type", index: 3, text: "hello", snapshotId: "snap-top" },
      { action: "press", key: "Enter" },
    ]);
    expect(result.completed).toBe(2);
    expect(result.stoppedAt).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("stops on a stale snapshotId reported as { error } mid-batch", async () => {
    const act = vi.fn(async (args: Record<string, unknown>) =>
      args.index === 1 ? { error: "Stale or unknown snapshotId — the page may have changed." } : { changed: true }
    );
    setPenDesktop(stubBrowser({ act, snapshot: async () => VALID_SNAPSHOT }));

    const result = JSON.parse(
      await browseAct({
        actions: [
          { action: "click", index: 0, snapshotId: "snap-1" },
          { action: "click", index: 1, snapshotId: "snap-1" },
        ],
      })
    );

    expect(act).toHaveBeenCalledTimes(2);
    expect(result.stoppedAt).toBe(1);
    expect(result.completed).toBe(1);
  });

  it("returns the documented error when window.penDesktop.browser is absent (web build)", async () => {
    const result = JSON.parse(
      await browseAct({ actions: [{ action: "click", index: 0 }] })
    );

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("rejects an actions array with more than 10 entries without calling the bridge", async () => {
    const act = vi.fn(async () => ({}));
    setPenDesktop(stubBrowser({ act }));

    const actions = Array.from({ length: 11 }, (_, i) => ({ action: "click", index: i }));
    const result = JSON.parse(await browseAct({ actions }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/at most 10/);
  });

  it("rejects an empty actions array without calling the bridge", async () => {
    const act = vi.fn(async () => ({}));
    setPenDesktop(stubBrowser({ act }));

    const result = JSON.parse(await browseAct({ actions: [] }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/at least 1/);
  });

  it("resolves `element` per-entry inside a batch, same as a single browse_act call", async () => {
    stubLocateFetch({ outcome: "found", index: 2, label: "Search", confidence: 0.9, model: "jev" });

    const receivedActArgs = recordingActBrowser();

    const result = JSON.parse(
      await browseAct({ actions: [{ action: "click", element: "the search button" }] })
    );

    expect(receivedActArgs).toEqual([{ action: "click", index: 2, snapshotId: "snap-fresh" }]);
    expect(result.completed).toBe(1);
  });

  // browse-speed-contract.md, "Frontend" item 3: an `element` entry
  // re-snapshots the page, which makes the batch's top-level snapshotId (and
  // any index-based entry after it) stale.
  it("rejects a batch where an index-based entry comes after an `element` entry, before calling the bridge", async () => {
    const act = vi.fn(async () => ({}));
    const snapshot = vi.fn(async () => VALID_SNAPSHOT);
    vi.stubGlobal("fetch", vi.fn());
    setPenDesktop(stubBrowser({ act, snapshot }));

    const result = JSON.parse(
      await browseAct({
        actions: [
          { action: "click", element: "the search button" },
          { action: "click", index: 1 },
        ],
      })
    );

    expect(act).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
    expect(result.error).toMatch(/element entries re-snapshot the page; put them last or split the batch/);
  });

  it("allows an `element` entry as the LAST entry in a batch (order is fine)", async () => {
    stubLocateFetch({ outcome: "found", index: 2, label: "Search", confidence: 0.9, model: "jev" });

    const receivedActArgs = recordingActBrowser();

    const result = JSON.parse(
      await browseAct({
        snapshotId: "snap-top",
        actions: [
          { action: "click", index: 0 },
          { action: "click", element: "the search button" },
        ],
      })
    );

    expect(receivedActArgs).toEqual([
      { action: "click", index: 0, snapshotId: "snap-top" },
      { action: "click", index: 2, snapshotId: "snap-fresh" },
    ]);
    expect(result.completed).toBe(2);
  });

  it("does not reject a batch where an `element` entry is followed only by target-based (non-index) entries", async () => {
    stubLocateFetch({ outcome: "found", index: 2, label: "Search", confidence: 0.9, model: "jev" });

    setPenDesktop(stubBrowser({
        snapshot: async () => VALID_SNAPSHOT,
        act: async () => ({ matched: "ok", changed: true }),
      }));

    const result = JSON.parse(
      await browseAct({
        actions: [
          { action: "click", element: "the search button" },
          { action: "click", target: "Submit" },
        ],
      })
    );

    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(2);
  });

  // browse-speed-contract.md, "Frontend" item 4: a batch must not keep
  // running past the frontend's own 120s browse_act tool-call timeout.
  it("stops the batch once the deadline is reached, returning partial results with stoppedAt and an error", async () => {
    let now = 0;
    let callCount = 0;
    setPenDesktop(stubBrowser({
        act: async () => {
          callCount++;
          // Each entry "takes" 30s of wall-clock time — the deadline check
          // at the top of the loop must catch this before starting a 3rd
          // entry (2 * 30s = 60s == the 60s batch budget).
          now += 30_000;
          return { matched: "ok", changed: true };
        },
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(
      await runActionsBatch(
        window.penDesktop!.browser!,
        [
          { action: "click", index: 0 },
          { action: "click", index: 1 },
          { action: "click", index: 2 },
        ],
        "snap-top",
        () => now
      )
    );

    expect(callCount).toBe(2);
    expect(result.completed).toBe(2);
    expect(result.stoppedAt).toBe(2);
    expect(result.error).toMatch(/batch deadline reached/);
    expect(result.results).toHaveLength(2);
    // Finding: once the deadline has passed, the trailing attachSnapshot
    // call is skipped entirely — no `snapshot` field on the result.
    expect(result.snapshot).toBeUndefined();
  });

  it("still attaches the final snapshot when the batch finishes within the deadline", async () => {
    setPenDesktop(stubBrowser({
        act: async () => ({ matched: "ok", changed: true }),
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(
      await runActionsBatch(window.penDesktop!.browser!, [{ action: "click", index: 0 }], "snap-top")
    );

    expect(result.error).toBeUndefined();
    expect(result.snapshot).toEqual(VALID_SNAPSHOT);
  });

  it("skips the trailing snapshot when a single entry's own duration pushes past the deadline, even though it completed", async () => {
    let now = 0;
    setPenDesktop(stubBrowser({
        act: async () => {
          // This single entry itself takes longer than the whole batch
          // deadline (60s) — it still completes (nothing aborts an
          // in-flight bridge call), but by the time it resolves the
          // deadline has already passed.
          now += 70_000;
          return { matched: "ok", changed: true };
        },
        snapshot: async () => VALID_SNAPSHOT,
      }));

    const result = JSON.parse(
      await runActionsBatch(
        window.penDesktop!.browser!,
        [{ action: "click", index: 0 }],
        "snap-top",
        () => now
      )
    );

    expect(result.completed).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.snapshot).toBeUndefined();
  });
});
