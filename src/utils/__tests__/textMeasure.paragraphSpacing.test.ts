import { describe, it, expect } from "vitest";
import type { TextNode } from "@/types/scene";
import { measureTextAutoSize, measureTextFixedWidthHeight } from "@/utils/textMeasure";

// The test harness stubs canvas measureText at 8px per character
// (src/test/setup.ts), so width === text.length * 8 (+ letterSpacing).
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
    text: "",
    fontSize: 16,
    lineHeight: 1.2,
    textWidthMode: "fixed",
    ...overrides,
  } as TextNode;
}

describe("paragraphSpacing — auto-size height (measureTextAutoSize)", () => {
  it("adds no extra height when unset (default 0)", () => {
    const node = textNode({ text: "a\nb", textWidthMode: "auto" });
    const withoutSpacing = measureTextAutoSize(node);
    const withZeroSpacing = measureTextAutoSize({ ...node, paragraphSpacing: 0 });
    expect(withZeroSpacing.height).toBe(withoutSpacing.height);
  });

  it("adds (paragraphCount - 1) * paragraphSpacing to the height", () => {
    const node = textNode({ text: "a\nb\nc", textWidthMode: "auto" });
    const base = measureTextAutoSize(node).height;
    const spaced = measureTextAutoSize({ ...node, paragraphSpacing: 10 });
    // 3 paragraphs => 2 gaps of 10px each.
    expect(spaced.height).toBe(base + 20);
  });

  it("does not add a gap for a single paragraph", () => {
    const node = textNode({ text: "single line", textWidthMode: "auto" });
    const base = measureTextAutoSize(node).height;
    const spaced = measureTextAutoSize({ ...node, paragraphSpacing: 25 });
    expect(spaced.height).toBe(base);
  });
});

describe("paragraphSpacing — fixed-width auto-height (measureTextFixedWidthHeight)", () => {
  it("adds (paragraphCount - 1) * paragraphSpacing to the wrapped height", () => {
    const node = textNode({ text: "one\ntwo\nthree", width: 40 * CHAR });
    const base = measureTextFixedWidthHeight(node);
    const spaced = measureTextFixedWidthHeight({ ...node, paragraphSpacing: 8 });
    expect(spaced).toBe(base + 16);
  });

  it("counts paragraph gaps, not wrapped-line gaps — a paragraph that wraps into multiple lines only adds one gap after it", () => {
    // width 10*CHAR wraps "aaa bbb ccc ddd" into multiple lines, but it's a
    // single paragraph followed by one more paragraph: exactly one gap.
    const node = textNode({ text: "aaa bbb ccc ddd\nnext", width: 10 * CHAR });
    const base = measureTextFixedWidthHeight(node);
    const spaced = measureTextFixedWidthHeight({ ...node, paragraphSpacing: 12 });
    expect(spaced).toBe(base + 12);
  });

  it("respects maxLines truncation when computing paragraph gaps", () => {
    // Two single-line paragraphs, maxLines caps to 1 kept line — no gap left to add.
    const node = textNode({ text: "one\ntwo", width: 40 * CHAR, maxLines: 1 });
    const base = measureTextFixedWidthHeight(node);
    const spaced = measureTextFixedWidthHeight({ ...node, paragraphSpacing: 30 });
    expect(spaced).toBe(base);
  });
});
