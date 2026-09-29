import { afterEach, describe, expect, it } from "vitest";
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
  });

  it("adds cloud headroom without a desktop browser", () => {
    expect(getToolCallTimeoutMs("browse_open")).toBe(150_000);
    expect(getToolCallTimeoutMs("browse_act")).toBe(180_000);
    expect(getToolCallTimeoutMs("browse_tabs")).toBe(130_000);
    expect(getToolCallTimeoutMs("browse_snapshot")).toBe(90_000);
  });

  it("treats penDesktop without .browser as cloud, and leaves non-browse tools alone", () => {
    window.penDesktop = { onMenuCommand: () => () => {} };
    expect(getToolCallTimeoutMs("browse_open")).toBe(150_000);
    expect(getToolCallTimeoutMs("generate_image")).toBe(95_000);
  });
});
