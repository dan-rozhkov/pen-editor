import { describe, expect, it } from "vitest";
import { Container, Text } from "pixi.js";
import { createTextContainer, updateTextContainer } from "../textRenderer";
import type { TextNode } from "@/types/scene";

function textNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: "one\ntwo",
    fontSize: 16,
    fontFamily: "Arial",
    lineHeight: 1.2,
    textWidthMode: "auto",
    ...overrides,
  } as TextNode;
}

/** The multi-line rendering path's wrapper container (shared by list mode and paragraph-spaced mode). */
function multilineRoot(container: Container): Container | null {
  return container.getChildByLabel("text-list-root") as Container | null;
}

describe("paragraphSpacing — Pixi render", () => {
  it("plain single-paragraph text with paragraphSpacing renders via the single-Text fast path (no-op)", () => {
    const node = textNode({ text: "single line", paragraphSpacing: 20 });
    const container = createTextContainer(node);
    expect(multilineRoot(container)).toBeNull();
    expect(container.getChildByLabel("text-content")).toBeDefined();
  });

  it("multi-paragraph text with paragraphSpacing=0 stays on the single-Text fast path", () => {
    const node = textNode({ paragraphSpacing: 0 });
    const container = createTextContainer(node);
    expect(multilineRoot(container)).toBeNull();
  });

  it("multi-paragraph text with paragraphSpacing switches to the per-line rendering path", () => {
    const node = textNode({ paragraphSpacing: 20 });
    const container = createTextContainer(node);
    const root = multilineRoot(container);
    expect(root).toBeDefined();
  });

  it("inserts the paragraphSpacing gap between paragraphs' lines, in addition to normal line height", () => {
    const fontSize = 16;
    const lineHeight = 1.2;
    const spacing = 20;
    const node = textNode({ text: "one\ntwo", fontSize, lineHeight, paragraphSpacing: spacing });
    const container = createTextContainer(node);
    const root = multilineRoot(container)!;
    const line0 = root.getChildByLabel("text-line-0") as Text;
    const line1 = root.getChildByLabel("text-line-1") as Text;
    expect(line0.y).toBe(0);
    expect(line1.y).toBe(fontSize * lineHeight + spacing);
  });

  it("does not insert a gap within a single wrapped paragraph's own soft-wrapped lines", () => {
    // "aaa bbb ccc ddd" wraps into >1 line at a narrow width; it's still one
    // paragraph, so consecutive wrapped lines are exactly one lineHeight apart.
    const fontSize = 16;
    const lineHeight = 1.2;
    const node = textNode({
      text: "aaa bbb ccc ddd\nnext",
      width: 10 * 8,
      textWidthMode: "fixed",
      fontSize,
      lineHeight,
      paragraphSpacing: 20,
    });
    const container = createTextContainer(node);
    const root = multilineRoot(container)!;
    const line0 = root.getChildByLabel("text-line-0") as Text;
    const line1 = root.getChildByLabel("text-line-1") as Text;
    expect(line1.y - line0.y).toBe(fontSize * lineHeight);
  });

  it("rebuilds the container when paragraphSpacing changes", () => {
    const node = textNode({ paragraphSpacing: 10 });
    const container = createTextContainer(node);
    const before = multilineRoot(container);

    const updated = { ...node, paragraphSpacing: 30 };
    updateTextContainer(container, updated, node);

    expect(multilineRoot(container)).not.toBe(before);
  });

  it("switches from the fast path to the multi-line path when paragraphSpacing becomes nonzero", () => {
    const node = textNode({ paragraphSpacing: 0 });
    const container = createTextContainer(node);
    expect(container.getChildByLabel("text-content")).toBeDefined();

    const updated = { ...node, paragraphSpacing: 15 };
    updateTextContainer(container, updated, node);

    expect(multilineRoot(container)).toBeDefined();
    expect(container.getChildByLabel("text-content")).toBeNull();
  });
});

describe("paragraphSpacing — line-limit truncation on the per-line path", () => {
  /** Count the rendered body `Text` lines (labelled `text-line-N`) under the multiline root. */
  function lineTexts(container: Container): Text[] {
    const root = multilineRoot(container)!;
    const result: Text[] = [];
    for (let i = 0; ; i++) {
      const t = root.getChildByLabel(`text-line-${i}`) as Text | null;
      if (!t) break;
      result.push(t);
    }
    return result;
  }

  it("honours maxLines together with paragraphSpacing (drops extra lines, ellipsizes the last kept one)", () => {
    // 3 single-line paragraphs, maxLines caps to 2 — the paragraph-spaced
    // per-line path must truncate the same way the plain fast path does, or
    // the box (sized by measureTextFixedWidthHeight to 2 lines) overflows.
    const node = textNode({
      text: "one\ntwo\nthree",
      width: 1000,
      textWidthMode: "fixed",
      maxLines: 2,
      paragraphSpacing: 10,
    });
    const container = createTextContainer(node);
    const lines = lineTexts(container);
    expect(lines).toHaveLength(2);
    expect(lines[lines.length - 1].text).toBe("two…");
  });

  it("honours fixed-height truncateText together with paragraphSpacing", () => {
    // fontSize 16 * lineHeight 1.2 = 19.2px/line. height 40 => floor(40/19.2)=2.
    const node = textNode({
      text: "one\ntwo\nthree\nfour",
      width: 1000,
      height: 40,
      textWidthMode: "fixed-height",
      truncateText: true,
      paragraphSpacing: 8,
    });
    const container = createTextContainer(node);
    const lines = lineTexts(container);
    expect(lines).toHaveLength(2);
    expect(lines[lines.length - 1].text).toBe("two…");
  });

  it("does not truncate when there is no line limit (plain multi-paragraph auto text)", () => {
    const node = textNode({
      text: "one\ntwo\nthree",
      textWidthMode: "auto",
      paragraphSpacing: 10,
    });
    const container = createTextContainer(node);
    expect(lineTexts(container)).toHaveLength(3);
  });
});
