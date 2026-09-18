import { afterEach, describe, expect, it } from "vitest";
import { browseOpen } from "@/lib/tools/browser/browseOpen";
import { browseAct } from "@/lib/tools/browser/browseAct";
import { browseFindImages } from "@/lib/tools/browser/browseFindImages";
import { browseRead } from "@/lib/tools/browser/browseRead";
import { BROWSER_NOT_AVAILABLE_ERROR } from "@/lib/tools/browser/shared";

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
