import { afterEach, describe, expect, it } from "vitest";
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
