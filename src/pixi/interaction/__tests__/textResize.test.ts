import { describe, it, expect } from "vitest";
import type { TextNode } from "@/types/scene";
import {
  resolveTextResize,
  resolveTextHandleReset,
  minTextWidth,
} from "@/pixi/interaction/textResize";

// 8px/char stub from src/test/setup.ts.
const CHAR = 8;

function textNode(overrides: Partial<TextNode>): TextNode {
  return {
    id: "t",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    width: 80,
    height: 20,
    text: "aaa bbb ccc",
    fontSize: 16,
    lineHeight: 1.2,
    textWidthMode: "auto",
    ...overrides,
  } as TextNode;
}

describe("resolveTextResize", () => {
  it("side (right) handle switches to auto-height and re-measures height", () => {
    const node = textNode({ width: 200 });
    // Shrink to 5 chars wide => "aaa bbb ccc" wraps to 3 lines.
    const r = resolveTextResize(node, "r", 5 * CHAR, 999);
    expect(r.textWidthMode).toBe("fixed");
    expect(r.width).toBe(5 * CHAR);
    expect(r.height).toBe(Math.ceil(3 * 16 * 1.2));
  });

  it("side (left) handle also switches to auto-height", () => {
    const r = resolveTextResize(textNode({}), "l", 100, 50);
    expect(r.textWidthMode).toBe("fixed");
  });

  it("corner handle switches to fixed-size without remeasuring height", () => {
    const r = resolveTextResize(textNode({}), "br", 120, 90);
    expect(r.textWidthMode).toBe("fixed-height");
    expect(r.width).toBe(120);
    expect(r.height).toBe(90);
  });

  it("top/bottom handles switch to fixed-size", () => {
    expect(resolveTextResize(textNode({}), "b", 80, 40).textWidthMode).toBe(
      "fixed-height",
    );
    expect(resolveTextResize(textNode({}), "t", 80, 40).textWidthMode).toBe(
      "fixed-height",
    );
  });
});

describe("resolveTextHandleReset", () => {
  it("side handles reset to auto-width", () => {
    expect(resolveTextHandleReset("l")).toBe("auto");
    expect(resolveTextHandleReset("r")).toBe("auto");
  });
  it("bottom/top handles reset to auto-height (fixed)", () => {
    expect(resolveTextHandleReset("b")).toBe("fixed");
    expect(resolveTextHandleReset("t")).toBe("fixed");
  });
  it("corner handles reset to auto-width", () => {
    expect(resolveTextHandleReset("br")).toBe("auto");
    expect(resolveTextHandleReset("tl")).toBe("auto");
  });
});

describe("minTextWidth", () => {
  it("returns the widest single character width", () => {
    // All chars are 8px in the stub; widest single char = 8.
    expect(minTextWidth(textNode({ text: "abc" }))).toBe(CHAR);
  });
  it("ignores spaces and newlines", () => {
    expect(minTextWidth(textNode({ text: "a b\nc" }))).toBe(CHAR);
  });
});
