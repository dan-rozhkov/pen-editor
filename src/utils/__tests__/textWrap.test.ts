import { describe, it, expect } from "vitest";
import type { TextNode } from "@/types/scene";
import { wrapTextToLines, truncateLines, getLineLimit } from "@/utils/textWrap";
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

describe("getLineLimit", () => {
  it("is Infinity with no truncation settings", () => {
    expect(getLineLimit(textNode({}))).toBe(Infinity);
  });

  it("returns maxLines in wrapped modes", () => {
    expect(getLineLimit(textNode({ maxLines: 3 }))).toBe(3);
    expect(
      getLineLimit(textNode({ maxLines: 3, textWidthMode: "fixed-height" })),
    ).toBe(3);
  });

  it("ignores maxLines in auto-width mode", () => {
    // 'auto' lays out without a wrap width, so truncation never applies.
    expect(
      getLineLimit(textNode({ maxLines: 2, textWidthMode: "auto" })),
    ).toBe(Infinity);
  });

  it("ignores maxLines below 1", () => {
    expect(getLineLimit(textNode({ maxLines: 0 }))).toBe(Infinity);
  });

  it("derives a height limit only in fixed-height + truncateText", () => {
    // fontSize 16 * lineHeight 1.2 = 19.2px/line. height 60 => floor(60/19.2)=3.
    const base = { textWidthMode: "fixed-height" as const, height: 60 };
    expect(getLineLimit(textNode({ ...base, truncateText: true }))).toBe(3);
    // Without the toggle the box height does not constrain lines.
    expect(getLineLimit(textNode({ ...base }))).toBe(Infinity);
    // 'fixed' (auto-height) has no height limit even with the toggle on.
    expect(
      getLineLimit(
        textNode({ textWidthMode: "fixed", height: 60, truncateText: true }),
      ),
    ).toBe(Infinity);
  });

  it("takes the tighter of maxLines and the height fit", () => {
    const base = {
      textWidthMode: "fixed-height" as const,
      height: 60,
      truncateText: true,
    };
    expect(getLineLimit(textNode({ ...base, maxLines: 2 }))).toBe(2);
    expect(getLineLimit(textNode({ ...base, maxLines: 5 }))).toBe(3);
  });
});

describe("truncateLines", () => {
  const lines4 = ["aaaa", "bbbb", "cccc", "dddd"];

  it("is a no-op when under the limit", () => {
    const node = textNode({ maxLines: 5 });
    expect(truncateLines(node, lines4, 80)).toBe(lines4);
  });

  it("drops extra lines and appends an ellipsis to the last kept line", () => {
    // width 80 = 10 chars; "bbbb…" = 5 chars fits.
    const node = textNode({ maxLines: 2, width: 80 });
    expect(truncateLines(node, lines4, node.width)).toEqual(["aaaa", "bbbb…"]);
  });

  it("trims characters so the ellipsis fits the box width", () => {
    // width 40 = 5 chars. Last kept line "bbbbbb" (6) + "…" would be 7 chars
    // (56px) > 40, so trim to "bbbb…" (5 chars = 40px).
    const node = textNode({ maxLines: 1, width: 5 * CHAR });
    expect(truncateLines(node, ["bbbbbb", "x"], node.width)).toEqual(["bbbb…"]);
  });

  it("truncates by box height in fixed-height + truncateText mode", () => {
    // height 40, 19.2px/line => floor(40/19.2)=2 lines kept.
    const node = textNode({
      textWidthMode: "fixed-height",
      truncateText: true,
      height: 40,
      width: 80,
    });
    expect(truncateLines(node, lines4, node.width)).toEqual(["aaaa", "bbbb…"]);
  });

  it("does not truncate auto-width text even with maxLines", () => {
    // 'auto' still respects maxLines via getLineLimit, but a single-paragraph
    // auto node has one line, so a multi-line input here is purely the limit.
    const node = textNode({ textWidthMode: "auto", width: 80 });
    expect(truncateLines(node, lines4, node.width)).toBe(lines4);
  });
});
