import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useVariableStore } from "@/store/variableStore";
import { resetStores, seedVariables } from "@/test/fixtures";
import {
  parseColor,
  parseAlpha,
  escapeXmlAttr,
  pushRenderTheme,
  popRenderTheme,
  resetRenderThemeStack,
  getRenderThemeStackDepth,
  getResolvedFill,
} from "@/pixi/renderers/colorHelpers";

describe("parseColor", () => {
  it("parses 6-char hex", () => {
    expect(parseColor("#ff0000")).toBe(0xff0000);
  });

  it("expands 3-char hex", () => {
    expect(parseColor("#f00")).toBe(0xff0000);
  });

  it("strips alpha from 8-char hex", () => {
    expect(parseColor("#ff000080")).toBe(0xff0000);
  });

  it("parses rgb()", () => {
    expect(parseColor("rgb(255, 0, 0)")).toBe(0xff0000);
  });

  it("parses rgba() ignoring alpha", () => {
    expect(parseColor("rgba(0, 128, 255, 0.5)")).toBe(0x0080ff);
  });

  it("falls back to black on garbage input", () => {
    expect(parseColor("not-a-color")).toBe(0x000000);
  });
});

describe("parseAlpha", () => {
  it("reads alpha from rgba()", () => {
    expect(parseAlpha("rgba(0,0,0,0.25)")).toBe(0.25);
  });

  it("reads alpha from 8-char hex", () => {
    expect(parseAlpha("#11223344")).toBe(0x44 / 255);
  });

  it("returns 1 for 6-char hex", () => {
    expect(parseAlpha("#112233")).toBe(1);
  });

  it("returns 1 for rgb() without alpha", () => {
    expect(parseAlpha("rgb(1,2,3)")).toBe(1);
  });
});

describe("escapeXmlAttr", () => {
  it("escapes &, \", <, >", () => {
    expect(escapeXmlAttr('a&b"c<d>e')).toBe("a&amp;b&quot;c&lt;d&gt;e");
  });
});

describe("render theme stack", () => {
  beforeEach(() => {
    resetStores();
    resetRenderThemeStack();
  });

  it("starts at depth 0 and tracks push/pop", () => {
    expect(getRenderThemeStackDepth()).toBe(0);
    pushRenderTheme("dark");
    expect(getRenderThemeStackDepth()).toBe(1);
    pushRenderTheme("light");
    expect(getRenderThemeStackDepth()).toBe(2);
    popRenderTheme();
    expect(getRenderThemeStackDepth()).toBe(1);
    popRenderTheme();
    expect(getRenderThemeStackDepth()).toBe(0);
  });

  it("resolves a bound fill against the dark theme while pushed, and light after pop", () => {
    seedVariables();
    // var-primary: themeValues { light: "#3366ff", dark: "#99bbff" }
    const node = {
      id: "n1",
      type: "rect",
      fillBinding: { variableId: "var-primary" },
    } as unknown as FlatSceneNode;

    // Default (empty stack) -> light theme value.
    expect(getResolvedFill(node)).toBe("#3366ff");

    pushRenderTheme("dark");
    expect(getResolvedFill(node)).toBe("#99bbff");

    popRenderTheme();
    expect(getResolvedFill(node)).toBe("#3366ff");
  });

  it("passes an unbound literal fill through unchanged", () => {
    expect(useVariableStore.getState().variables).toEqual([]);
    const node = { fill: "#123456" } as unknown as FlatSceneNode;
    expect(getResolvedFill(node)).toBe("#123456");
  });
});
