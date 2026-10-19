import { afterEach, describe, expect, it } from "vitest";
import { browseTaskInnerBoundMs } from "@sideform/browser-agent/loop";
import { getToolCallTimeoutMs } from "../useDesignChat";

afterEach(() => {
  delete window.penDesktop;
});

describe("getToolCallTimeoutMs browse_* desktop/cloud split", () => {
  it("keeps the desktop values when window.penDesktop.browser exists", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    expect(getToolCallTimeoutMs("browse_open")).toBe(70_000);
    expect(getToolCallTimeoutMs("browse_act")).toBe(120_000);
    expect(getToolCallTimeoutMs("browse_snapshot")).toBe(30_000);
    expect(getToolCallTimeoutMs("browse_task")).toBe(browseTaskInnerBoundMs(false) + 60_000);
    expect(getToolCallTimeoutMs("browse_agent")).toBe(900_000);
  });

  it("adds cloud headroom without a desktop browser", () => {
    expect(getToolCallTimeoutMs("browse_open")).toBe(150_000);
    expect(getToolCallTimeoutMs("browse_act")).toBe(180_000);
    expect(getToolCallTimeoutMs("browse_tabs")).toBe(130_000);
    expect(getToolCallTimeoutMs("browse_snapshot")).toBe(90_000);
    // Covers the cloud loop's longer deadline (browseTask.ts).
    expect(getToolCallTimeoutMs("browse_task")).toBe(browseTaskInnerBoundMs(true) + 60_000);
    // No cloud headroom on top: the nested calls carry their own.
    expect(getToolCallTimeoutMs("browse_agent")).toBe(900_000);
  });

  it("treats penDesktop without .browser as cloud, and leaves non-browse tools alone", () => {
    window.penDesktop = { onMenuCommand: () => () => {} };
    expect(getToolCallTimeoutMs("browse_open")).toBe(150_000);
    expect(getToolCallTimeoutMs("generate_image")).toBe(95_000);
  });
});

describe("getToolCallTimeoutMs open_canvas_tab", () => {
  it("leaves room for a cold canvas tab load", () => {
    expect(getToolCallTimeoutMs("open_canvas_tab")).toBe(60_000);
  });
});

describe("getToolCallTimeoutMs app launch", () => {
  it("gives browse_open 150s and browse_agent +80s only when app is set", () => {
    window.penDesktop = { onMenuCommand: () => () => {}, browser: {} } as never;
    expect(getToolCallTimeoutMs("browse_open", { url: "https://a.b" })).toBe(70_000);
    expect(getToolCallTimeoutMs("browse_open", { app: "Notes" })).toBe(150_000);
    expect(getToolCallTimeoutMs("browse_open", { app: "  " })).toBe(70_000);
    expect(getToolCallTimeoutMs("browse_agent", { goal: "x" })).toBe(900_000);
    expect(getToolCallTimeoutMs("browse_agent", { goal: "x", app: "Notes" })).toBe(980_000);
  });
});
