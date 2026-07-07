import { describe, it, expect } from "vitest";
import type { TextNode } from "@/types/scene";
import { layoutTextParagraphs } from "@/utils/textWrap";
import { LIST_INDENT_WIDTH, LIST_MARKER_GAP } from "@/lib/textLists/paragraphs";

// The test harness stubs canvas measureText at 8px per character (src/test/setup.ts).
const CHAR = 8;

function textNode(overrides: Partial<TextNode>): TextNode {
  return {
    id: "t",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    width: 200,
    height: 20,
    text: "",
    fontSize: 16,
    lineHeight: 1.2,
    textWidthMode: "fixed",
    ...overrides,
  } as TextNode;
}

describe("layoutTextParagraphs", () => {
  it("plain text (no paragraphs field) has no markers and zero x-offset", () => {
    const node = textNode({ text: "hello world", width: 1000 });
    const { lines, markers } = layoutTextParagraphs(node, 1000);
    expect(markers).toEqual([]);
    expect(lines).toEqual([{ text: "hello world", paragraphIndex: 0, isFirstLine: true, x: 0 }]);
  });

  it("a bullet paragraph gets a marker and every wrapped line shares the hanging x-offset", () => {
    const node = textNode({
      text: "aaa bbb ccc ddd",
      width: 1000,
      paragraphs: [{ listType: "bullet", indentLevel: 0 }],
    });
    // marker "•" is 1 char = 8px wide; hanging = 8 + LIST_MARKER_GAP
    const hangingPx = CHAR + LIST_MARKER_GAP;
    const maxWidth = 10 * CHAR + hangingPx; // room for "aaa bbb " on first wrapped line after indent
    const { lines, markers } = layoutTextParagraphs(node, maxWidth);
    expect(markers).toEqual([{ paragraphIndex: 0, text: "•", x: 0, width: CHAR }]);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(line.x).toBe(hangingPx);
      expect(line.paragraphIndex).toBe(0);
    }
  });

  it("indentLevel pushes both the marker and the hanging indent further right", () => {
    const node = textNode({
      text: "a",
      width: 1000,
      paragraphs: [{ listType: "bullet", indentLevel: 2 }],
    });
    const { lines, markers } = layoutTextParagraphs(node, 1000);
    expect(markers[0].x).toBe(2 * LIST_INDENT_WIDTH);
    expect(lines[0].x).toBe(2 * LIST_INDENT_WIDTH + CHAR + LIST_MARKER_GAP);
  });

  it("numbered marker width reflects the actual digit count", () => {
    const node = textNode({
      text: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj",
      width: 1000,
      paragraphs: Array.from({ length: 10 }, () => ({ listType: "number" as const })),
    });
    const { markers } = layoutTextParagraphs(node, 1000);
    expect(markers[8].text).toBe("9."); // 1 char + '.' = 2 chars
    expect(markers[8].width).toBe(2 * CHAR);
    expect(markers[9].text).toBe("10."); // 2 chars + '.' = 3 chars
    expect(markers[9].width).toBe(3 * CHAR);
  });

  it("maxWidth === null (auto mode) never wraps — one line per paragraph", () => {
    const node = textNode({
      text: "a very long line of text that would otherwise wrap\nsecond",
      textWidthMode: "auto",
      paragraphs: [{ listType: "bullet" }, {}],
    });
    const { lines } = layoutTextParagraphs(node, null);
    expect(lines).toHaveLength(2);
    expect(lines[0].isFirstLine).toBe(true);
    expect(lines[1].x).toBe(0);
  });

  it("mixed list/plain paragraphs: plain paragraphs get x=0 regardless of stored indentLevel", () => {
    const node = textNode({
      text: "title\nitem",
      width: 1000,
      paragraphs: [{ listType: "none", indentLevel: 3 }, { listType: "bullet" }],
    });
    const { lines, markers } = layoutTextParagraphs(node, 1000);
    expect(lines[0]).toMatchObject({ paragraphIndex: 0, x: 0 });
    expect(markers).toHaveLength(1);
    expect(markers[0].paragraphIndex).toBe(1);
  });
});
