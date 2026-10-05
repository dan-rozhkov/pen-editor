import { beforeEach, describe, expect, it, vi } from "vitest";

const shareCurrentCanvas = vi.fn();
vi.mock("@/lib/shareCanvas", () => ({ shareCurrentCanvas: () => shareCurrentCanvas() }));

import { embedAppBase, openInSideform } from "../openInSideform";

beforeEach(() => shareCurrentCanvas.mockReset());

describe("openInSideform", () => {
  it("shares the canvas and opens the app-origin link through the host", async () => {
    shareCurrentCanvas.mockResolvedValue({ ok: true, id: "abc", editToken: "t", url: "https://sandbox.invalid/c/abc" });
    const openLink = vi.fn(async () => true);
    const result = await openInSideform(openLink, "https://app.sideform.pro");
    expect(openLink).toHaveBeenCalledWith("https://app.sideform.pro/c/abc");
    expect(result).toEqual({ ok: true, url: "https://app.sideform.pro/c/abc" });
  });

  it("reports a share failure without opening anything", async () => {
    shareCurrentCanvas.mockResolvedValue({ ok: false, error: "offline" });
    const openLink = vi.fn();
    expect(await openInSideform(openLink, "https://x")).toEqual({ ok: false, error: "offline" });
    expect(openLink).not.toHaveBeenCalled();
  });

  it("reports a host that refuses to open the link", async () => {
    shareCurrentCanvas.mockResolvedValue({ ok: true, id: "abc", editToken: "t", url: "u" });
    const result = await openInSideform(async () => false, "https://x");
    expect(result.ok).toBe(false);
  });

  it("derives the app base from where the bundle was served, not the page", () => {
    expect(embedAppBase("https://app.sideform.pro/assets/embed-1.js")).toBe("https://app.sideform.pro");
  });
});
