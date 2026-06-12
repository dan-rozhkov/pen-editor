import { describe, it, expect } from "vitest";
import type { TextNode } from "@/types/scene";
import { wrapTextToLines } from "@/utils/textWrap";
import { measureTextFixedWidthHeight } from "@/utils/textMeasure";

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

describe("wrapTextToLines", () => {
  it("wraps at spaces (greedy first-fit)", () => {
    // width 80 => 10 chars per line.
    const node = textNode({ text: "aaa bbb ccc ddd", width: 10 * CHAR });
    expect(wrapTextToLines(node, node.width)).toEqual(["aaa bbb ", "ccc ddd"]);
  });

  it("preserves multiple spaces (no /\\s+/ collapse)", () => {
    const node = textNode({ text: "a   b", width: 1000 });
    expect(wrapTextToLines(node, node.width)).toEqual(["a   b"]);
  });

  it("preserves empty paragraphs as empty lines", () => {
    const node = textNode({ text: "a\n\nb", width: 1000 });
    expect(wrapTextToLines(node, node.width)).toEqual(["a", "", "b"]);
  });

  it("honours explicit newlines as paragraph breaks", () => {
    const node = textNode({ text: "ab\ncd", width: 1000 });
    expect(wrapTextToLines(node, node.width)).toEqual(["ab", "cd"]);
  });

  it("breaks a single over-long word mid-word at the last fitting char", () => {
    // width 40 => 5 chars per line.
    const node = textNode({ text: "abcdefghij", width: 5 * CHAR });
    expect(wrapTextToLines(node, node.width)).toEqual(["abcde", "fghij"]);
  });

  it("breaks after a hyphen", () => {
    // width 48 => 6 chars. "well-" (5) fits, then "being".
    const node = textNode({ text: "well-being", width: 6 * CHAR });
    expect(wrapTextToLines(node, node.width)).toEqual(["well-", "being"]);
  });

  it("wraps CJK character-by-character", () => {
    // width 24 => 3 chars per line.
    const node = textNode({ text: "日本語のテキスト", width: 3 * CHAR });
    const lines = wrapTextToLines(node, node.width);
    expect(lines).toEqual(["日本語", "のテキ", "スト"]);
  });

  it("does not break at a non-breaking space (U+00A0)", () => {
    const NBSP = String.fromCharCode(0xa0);
    // NBSP joins a+b into one unbreakable unit (3 chars = 24px); the regular
    // space before c is a break point. width 24 => unit fits, c wraps.
    const node = textNode({ text: `a${NBSP}b c`, width: 3 * CHAR });
    expect(wrapTextToLines(node, node.width)).toEqual([`a${NBSP}b `, "c"]);
  });

  it("letterSpacing reduces line capacity", () => {
    // width 40 = 5*8. With letterSpacing 2, "aaaa" = 4*8 + 3*2 = 38 fits,
    // "aaaaa" = 5*8 + 4*2 = 48 does not.
    const node = textNode({ text: "aaaaa", width: 5 * CHAR, letterSpacing: 2 });
    expect(wrapTextToLines(node, node.width)).toEqual(["aaaa", "a"]);
  });

  it("line count × fontSize × lineHeight equals measureTextFixedWidthHeight", () => {
    const node = textNode({ text: "aaa bbb ccc ddd", width: 10 * CHAR });
    const lines = wrapTextToLines(node, node.width);
    const expected = Math.ceil(lines.length * 16 * 1.2);
    expect(measureTextFixedWidthHeight(node)).toBe(expected);
  });
});
