import { afterEach, describe, expect, it, vi } from "vitest";
import { browseOpen } from "@/lib/tools/browser/browseOpen";
import { browseAct } from "@/lib/tools/browser/browseAct";
import { browseFindImages } from "@/lib/tools/browser/browseFindImages";
import { browseRead } from "@/lib/tools/browser/browseRead";
import { browseSnapshot } from "@/lib/tools/browser/browseSnapshot";
import { browseScreenshot } from "@/lib/tools/browser/browseScreenshot";
import { browseTabs } from "@/lib/tools/browser/browseTabs";
import {
  BROWSER_BRIDGE_METHOD_MISSING_ERROR,
  BROWSER_NOT_AVAILABLE_ERROR,
} from "@/lib/tools/browser/shared";

type PenDesktopBrowser = NonNullable<NonNullable<typeof window.penDesktop>["browser"]>;

function stubBrowser(overrides: Partial<PenDesktopBrowser>): PenDesktopBrowser {
  return {
    open: async () => ({}),
    act: async () => ({}),
    findImages: async () => ({}),
    read: async () => ({}),
    snapshot: async () => ({}),
    perform: async () => ({}),
    ...overrides,
  };
}

afterEach(() => {
  delete window.penDesktop;
  vi.unstubAllGlobals();
});

describe("browse_open", () => {
  it("forwards args to window.penDesktop.browser.open and returns the result", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        open: async (args) => {
          received = args;
          return { url: "https://pinterest.com/search?q=modern%20kitchen", title: "Pinterest" };
        },
      }),
    };

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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        open: async () => {
          throw new Error("browser:command timed out");
        },
      }),
    };

    const result = JSON.parse(await browseOpen({ url: "https://pinterest.com" }));

    expect(result).toEqual({ error: "browser:command timed out" });
  });

  // The bridge's declared return type is Promise<unknown>, which permits
  // undefined. JSON.stringify(undefined) is the value `undefined`, not a
  // string — ToolHandler's Promise<string> contract requires a real string,
  // and executeToolCall calling .startsWith on a non-string throws a
  // TypeError that masks the real (empty) result as a bogus error.
  it("returns a real JSON string, not the value undefined, when the bridge resolves undefined", async () => {
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        open: async () => undefined as any,
      }),
    };

    const result = await browseOpen({ url: "https://pinterest.com" });

    expect(typeof result).toBe("string");
    expect(() => JSON.parse(result)).not.toThrow();
    expect(JSON.parse(result)).toEqual({});
  });
});

describe("browse_act", () => {
  it("forwards args to window.penDesktop.browser.act and returns the result", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        act: async (args) => {
          received = args;
          return { url: "https://pinterest.com", title: "Pinterest", matched: "Search" };
        },
      }),
    };

    const result = JSON.parse(await browseAct({ action: "click", target: "Search" }));

    expect(received).toEqual({ action: "click", target: "Search" });
    expect(result).toEqual({ url: "https://pinterest.com", title: "Pinterest", matched: "Search" });
  });

  it("returns the documented error when window.penDesktop.browser is absent", async () => {
    const result = JSON.parse(await browseAct({ action: "scroll", amount: 1 }));

    expect(result).toEqual({ error: BROWSER_NOT_AVAILABLE_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        act: async () => {
          throw new Error("no browser tab open");
        },
      }),
    };

    const result = JSON.parse(await browseAct({ action: "back" }));

    expect(result).toEqual({ error: "no browser tab open" });
  });

  // Full browser use (docs/superpowers/specs/
  // 2026-09-23-full-browser-use-design.md) widens `act`'s argument shape —
  // index targeting, press/hover/select/reload/wait. browseAct is a thin,
  // untyped forwarder, so every new field must reach the bridge untouched.
  it("forwards index/snapshotId/key/ms and the new action values untouched", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        act: async (args) => {
          received = args;
          return { found: true };
        },
      }),
    };

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
        elements: [{ index: 2, tag: "button", label: "Search" }],
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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({
        act: async (args) => {
          receivedActArgs = args;
          return { url: "https://example.com", title: "Example", matched: "Search" };
        },
      }),
    };

    const result = JSON.parse(
      await browseAct({ action: "click", element: "the search button in the header" })
    );

    expect(receivedUrl).toContain("/api/browse/locate");
    expect(receivedBody).toEqual({
      description: "the search button in the header",
      operation: "CLICK",
      url: "https://example.com",
      title: "Example",
      elements: [{ index: 2, tag: "button", label: "Search" }],
    });
    expect(receivedActArgs).toEqual({ action: "click", index: 2, snapshotId: "snap-1" });
    expect(result).toEqual({
      url: "https://example.com",
      title: "Example",
      matched: "Search",
      resolved: {
        index: 2,
        label: "Search",
        confidence: 0.87,
        snapshotId: "snap-1",
        note: expect.stringContaining("stale"),
      },
    });
  });

  it("includes `resolved` (with the fresh snapshotId) on an error result when the act itself fails after a successful locate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "found", index: 2, label: "Search", confidence: 0.9, model: "jev" }),
      }))
    );

    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({
        act: async () => {
          throw new Error("target is gone or occluded");
        },
      }),
    };

    const result = JSON.parse(
      await browseAct({ action: "click", element: "the search button in the header" })
    );

    expect(result.error).toBe("target is gone or occluded");
    expect(result.resolved).toEqual({
      index: 2,
      label: "Search",
      confidence: 0.9,
      snapshotId: "snap-1",
      note: expect.stringContaining("stale"),
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

    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({ act: async () => ({}) }),
    };

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

    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser(),
    };

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "not_found", reason: "no candidate matched the description" }),
      }))
    );

    const act = vi.fn(async () => ({}));
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({ act }),
    };

    const result = JSON.parse(await browseAct({ action: "click", element: "a purple elephant" }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/No element matched "a purple elephant"/);
    expect(result.error).toMatch(/no candidate matched the description/);
    expect(result.error).toMatch(/browse_snapshot/);
  });

  it("returns a clear error and does not call act when outcome is retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ outcome: "retry", reason: "ambiguous, matched two candidates" }),
      }))
    );

    const act = vi.fn(async () => ({}));
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({ act }),
    };

    const result = JSON.parse(await browseAct({ action: "click", element: "a button" }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/target or index/i);
    expect(result.error).toMatch(/ambiguous, matched two candidates/);
  });

  it("returns a clear error when /api/browse/locate responds 503 (no fast model configured)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({}),
      }))
    );

    const act = vi.fn(async () => ({}));
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({ act }),
    };

    const result = JSON.parse(await browseAct({ action: "click", element: "a button" }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/not available/i);
    expect(result.error).toMatch(/target or index/i);
  });

  it("returns a clear error on a fetch failure resolving /api/browse/locate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    const act = vi.fn(async () => ({}));
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({ act }),
    };

    const result = JSON.parse(await browseAct({ action: "click", element: "a button" }));

    expect(act).not.toHaveBeenCalled();
    expect(result.error).toMatch(/network down/);
    expect(result.error).toMatch(/target or index/i);
  });

  it("returns a clear error when the pre-locate snapshot resolves { error }, without calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        snapshot: async () => ({ error: "No browser tab is open — call browse_open first." }),
      }),
    };

    const result = JSON.parse(await browseAct({ action: "click", element: "a button" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.error).toContain("No browser tab is open");
  });

  it("returns an error for an action that does not support `element` (e.g. scroll)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser(),
    };

    const result = JSON.parse(await browseAct({ action: "scroll", amount: 1, element: "the page" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.error).toMatch(/element/i);
  });

  it("prefers an explicit index over `element` and never calls /api/browse/locate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let receivedActArgs: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({
        act: async (args) => {
          receivedActArgs = args;
          return { matched: "by index" };
        },
      }),
    };

    await browseAct({ action: "click", index: 5, snapshotId: "snap-9", element: "the search button" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(receivedActArgs).toEqual({ action: "click", index: 5, snapshotId: "snap-9" });
  });

  it("prefers an explicit target over `element` and never calls /api/browse/locate", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let receivedActArgs: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubSnapshotBrowser({
        act: async (args) => {
          receivedActArgs = args;
          return { matched: "Search" };
        },
      }),
    };

    await browseAct({ action: "click", target: "Search", element: "the search button" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(receivedActArgs).toEqual({ action: "click", target: "Search" });
  });
});

describe("browse_snapshot", () => {
  it("forwards to window.penDesktop.browser.snapshot and returns the result", async () => {
    let called = false;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        snapshot: async () => {
          called = true;
          return { snapshotId: "snap-1", elements: [{ index: 0, tag: "button", text: "Search" }] };
        },
      }),
    };

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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        snapshot: async () => {
          throw new Error("no browser tab open");
        },
      }),
    };

    const result = JSON.parse(await browseSnapshot({}));

    expect(result).toEqual({ error: "no browser tab open" });
  });
});

describe("browse_screenshot", () => {
  it("forwards args to window.penDesktop.browser.screenshot and returns the result", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        screenshot: async (args) => {
          received = args;
          return { imageData: "data:image/jpeg;base64,AAAA", width: 800, height: 600, url: "https://example.com", title: "Example" };
        },
      }),
    };

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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({}),
    };
    expect(window.penDesktop.browser?.screenshot).toBeUndefined();

    const result = JSON.parse(await browseScreenshot({}));

    expect(result).toEqual({ error: BROWSER_BRIDGE_METHOD_MISSING_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        screenshot: async () => {
          throw new Error("capture failed");
        },
      }),
    };

    const result = JSON.parse(await browseScreenshot({}));

    expect(result).toEqual({ error: "capture failed" });
  });
});

describe("browse_tabs", () => {
  it("forwards args to window.penDesktop.browser.tabs and returns the result", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        tabs: async (args) => {
          received = args;
          return {
            tabs: [{ tabId: "t1", url: "https://example.com", title: "Example", current: true }],
            current: "t1",
          };
        },
      }),
    };

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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({}),
    };
    expect(window.penDesktop.browser?.tabs).toBeUndefined();

    const result = JSON.parse(await browseTabs({ action: "list" }));

    expect(result).toEqual({ error: BROWSER_BRIDGE_METHOD_MISSING_ERROR });
  });

  it("catches a rejecting preload call and returns it as a JSON error", async () => {
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        tabs: async () => {
          throw new Error("no such tab");
        },
      }),
    };

    const result = JSON.parse(await browseTabs({ action: "close", tabId: "t1" }));

    expect(result).toEqual({ error: "no such tab" });
  });
});

describe("browse_find_images", () => {
  it("forwards args to window.penDesktop.browser.findImages and returns the result", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        findImages: async (args) => {
          received = args;
          return {
            images: [{ url: "https://example.com/a.jpg", alt: "", width: 400, height: 300 }],
            count: 1,
            pageUrl: "https://pinterest.com",
          };
        },
      }),
    };

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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        findImages: async () => {
          throw new Error("page script threw");
        },
      }),
    };

    const result = JSON.parse(await browseFindImages({}));

    expect(result).toEqual({ error: "page script threw" });
  });
});

describe("browse_read", () => {
  it("forwards args to window.penDesktop.browser.read and returns the result", async () => {
    let received: unknown;
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
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
      }),
    };

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
    window.penDesktop = {
      onMenuCommand: () => () => {},
      browser: stubBrowser({
        read: async () => {
          throw new Error("no browser tab open");
        },
      }),
    };

    const result = JSON.parse(await browseRead({ selector: "#missing" }));

    expect(result).toEqual({ error: "no browser tab open" });
  });
});
