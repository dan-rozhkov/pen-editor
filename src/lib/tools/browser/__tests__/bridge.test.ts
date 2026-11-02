import { afterEach, describe, expect, it, vi } from "vitest";
import { getBrowserBridge, releaseDesktopChatApp, resetBrowserBridgeCacheForTests } from "@/lib/tools/browser/bridge";
import { cloudBrowserBridge, getCloudBrowserBridge } from "@/lib/cloudBrowser";
import { setPenDesktop, stubBrowser } from "./helpers";

afterEach(() => {
  delete window.penDesktop;
  resetBrowserBridgeCacheForTests();
});

/** A forChat factory whose bridges are distinct stubs, recorded per chat id. */
function stubForChat() {
  const made = new Map<string, ReturnType<typeof stubBrowser>>();
  const forChat = vi.fn((id: string) => {
    const b = stubBrowser({ releaseApp: vi.fn(async () => ({})) });
    made.set(id, b);
    return b;
  });
  return { forChat, made };
}

describe("getBrowserBridge", () => {
  it("returns the desktop bridge untouched when window.penDesktop.browser exists", () => {
    const desktop = setPenDesktop(stubBrowser());
    expect(getBrowserBridge()).toBe(desktop);
    expect(getBrowserBridge("chat-1")).toBe(desktop);
  });

  it("falls back to the cloud bridge on the web", () => {
    expect(getBrowserBridge()).toBe(cloudBrowserBridge);
  });

  it("binds the cloud bridge to the given chat, one instance per chat", () => {
    const a = getBrowserBridge("chat-a");
    expect(a).toBe(getCloudBrowserBridge("chat-a"));
    expect(a).not.toBe(getBrowserBridge("chat-b"));
  });

  it("uses the cloud bridge when the shell has no browser surface", () => {
    window.penDesktop = { onMenuCommand: () => () => {} };
    expect(getBrowserBridge()).toBe(cloudBrowserBridge);
  });
});

describe("browseAssertAvailable", () => {
  it("is true on the web, and on desktop only with browser.assert", async () => {
    const { browseAssertAvailable } = await import("@/lib/tools/browser/isolation");
    expect(browseAssertAvailable()).toBe(true);
    setPenDesktop(stubBrowser());
    expect(browseAssertAvailable()).toBe(false);
    setPenDesktop(stubBrowser({ assert: async () => ({}) }));
    expect(browseAssertAvailable()).toBe(true);
  });
});

describe("getBrowserBridge with browser.forChat", () => {
  it("returns the chat's own forChat bridge", () => {
    const { forChat } = stubForChat();
    const desktop = setPenDesktop(stubBrowser({ forChat }));
    const a = getBrowserBridge("tab-1-1");
    expect(a).not.toBe(desktop);
    getBrowserBridge("tab-1-2");
    expect(forChat.mock.calls.map((c) => c[0])).toEqual(["tab-1-1", "tab-1-2"]);
  });

  it("falls back to the shared bridge without chatId or with an invalid id", () => {
    const { forChat } = stubForChat();
    const desktop = setPenDesktop(stubBrowser({ forChat }));
    expect(getBrowserBridge()).toBe(desktop);
    expect(getBrowserBridge("bad id!")).toBe(desktop);
    expect(getBrowserBridge("a".repeat(65))).toBe(desktop);
    expect(forChat).not.toHaveBeenCalled();
  });

  it("falls back to the shared bridge when the shell has no forChat", () => {
    const desktop = setPenDesktop(stubBrowser());
    expect(getBrowserBridge("tab-1-1")).toBe(desktop);
  });

  it("lets browserSession win over forChat", () => {
    const { forChat } = stubForChat();
    const isolatedBridge = stubBrowser();
    const isolated = vi.fn(() => isolatedBridge);
    setPenDesktop(stubBrowser({ forChat, isolated }));
    expect(getBrowserBridge("tab-1-1", "run-1")).toBe(isolatedBridge);
    expect(forChat).not.toHaveBeenCalled();
  });
});

describe("releaseDesktopChatApp", () => {
  it("calls releaseApp on that chat's bridge only", () => {
    const { forChat, made } = stubForChat();
    setPenDesktop(stubBrowser({ forChat }));
    releaseDesktopChatApp("tab-1-1");
    expect(made.get("tab-1-1")?.releaseApp).toHaveBeenCalledTimes(1);
    expect(forChat).toHaveBeenCalledTimes(1);
  });

  it("does nothing without forChat or with an invalid id", () => {
    const { forChat } = stubForChat();
    setPenDesktop(stubBrowser({ releaseApp: vi.fn(async () => ({})) }));
    expect(() => releaseDesktopChatApp("tab-1-1")).not.toThrow();
    setPenDesktop(stubBrowser({ forChat }));
    releaseDesktopChatApp("bad id!");
    expect(forChat).not.toHaveBeenCalled();
  });

  it("never throws, even when releaseApp rejects or throws", async () => {
    setPenDesktop(
      stubBrowser({
        forChat: () => stubBrowser({ releaseApp: async () => Promise.reject(new Error("x")) }),
      })
    );
    expect(() => releaseDesktopChatApp("tab-1-1")).not.toThrow();
    setPenDesktop(
      stubBrowser({
        forChat: () => {
          throw new Error("boom");
        },
      })
    );
    expect(() => releaseDesktopChatApp("tab-1-2")).not.toThrow();
    await Promise.resolve();
  });
});
