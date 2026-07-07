import { describe, it, expect } from "vitest";
import { convertNodeToHtml, type ConversionContext } from "../convertNode";
import type { FlatSceneNode, TextNode } from "@/types/scene";

function textNode(overrides: Partial<TextNode> = {}): FlatSceneNode {
  return {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: "hello",
    ...overrides,
  } as unknown as FlatSceneNode;
}

function makeCtx(node: FlatSceneNode): ConversionContext {
  return { nodesById: { [node.id]: node }, childrenById: {}, allNodes: [] };
}

describe("designToHtml paragraphSpacing", () => {
  it("plain single-paragraph text with paragraphSpacing renders unchanged (still a span)", () => {
    const node = textNode({ text: "hello", paragraphSpacing: 20 });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<span");
    expect(html).not.toContain("margin-bottom");
  });

  it("multi-paragraph text with paragraphSpacing=0 renders unchanged (still a span)", () => {
    const node = textNode({ text: "one\ntwo", paragraphSpacing: 0 });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<span");
    expect(html).not.toContain("margin-bottom");
  });

  it("multi-paragraph text with paragraphSpacing wraps each paragraph in a div with margin-bottom, except the last", () => {
    const node = textNode({ text: "one\ntwo\nthree", paragraphSpacing: 16 });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain('<div style="margin-bottom:16px">one</div>');
    expect(html).toContain('<div style="margin-bottom:16px">two</div>');
    expect(html).toContain("<div>three</div>");
    expect(html).not.toContain('style="margin-bottom:16px">three');
  });

  it("wraps the whole thing in an outer div (block) instead of a span", () => {
    const node = textNode({ text: "one\ntwo", paragraphSpacing: 10 });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html.startsWith("<div")).toBe(true);
    expect(html).not.toContain("<span");
  });

  it("a bulleted list with paragraphSpacing puts margin-bottom on every <li> but the last", () => {
    const node = textNode({
      text: "one\ntwo\nthree",
      paragraphs: [{ listType: "bullet" }, { listType: "bullet" }, { listType: "bullet" }],
      paragraphSpacing: 12,
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain(
      '<ul><li style="margin-bottom:12px">one</li><li style="margin-bottom:12px">two</li><li>three</li></ul>',
    );
  });

  it("a list with paragraphSpacing=0 renders unchanged (no margin-bottom on <li>)", () => {
    const node = textNode({
      text: "one\ntwo",
      paragraphs: [{ listType: "bullet" }, { listType: "bullet" }],
      paragraphSpacing: 0,
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).not.toContain("margin-bottom");
  });

  it("mixed plain + list paragraphs with spacing: plain paragraphs get margin-bottom divs, last paragraph gets none", () => {
    const node = textNode({
      text: "heading\nitem",
      paragraphs: [{}, { listType: "bullet" }],
      paragraphSpacing: 8,
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    // "heading" is a plain paragraph before a list paragraph — it gets a gap.
    expect(html).toContain('<div style="margin-bottom:8px">heading</div>');
    // "item" is the last paragraph — no trailing gap on its <li>.
    expect(html).toContain("<ul><li>item</li></ul>");
  });
});
