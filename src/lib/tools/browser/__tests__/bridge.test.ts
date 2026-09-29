import { afterEach, describe, expect, it } from "vitest";
import { getBrowserBridge } from "@/lib/tools/browser/bridge";
import { cloudBrowserBridge, getCloudBrowserBridge } from "@/lib/cloudBrowser";
import { setPenDesktop, stubBrowser } from "./helpers";

afterEach(() => {
  delete window.penDesktop;
});

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
