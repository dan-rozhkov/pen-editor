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

describe("designToHtml text lists", () => {
  it("plain text (no active list) still renders as a span, unchanged", () => {
    const node = textNode({ text: "hello" });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<span");
    expect(html).not.toContain("<ul>");
  });

  it("a bulleted paragraph run renders as a <ul> of <li>s", () => {
    const node = textNode({
      text: "one\ntwo",
      paragraphs: [{ listType: "bullet" }, { listType: "bullet" }],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<div");
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
  });

  it("a numbered paragraph run renders as an <ol>", () => {
    const node = textNode({
      text: "one\ntwo",
      paragraphs: [{ listType: "number" }, { listType: "number" }],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<ol><li>one</li><li>two</li></ol>");
  });

  it("nests a deeper indentLevel list inside the previous <li>", () => {
    const node = textNode({
      text: "a\nb\nc",
      paragraphs: [
        { listType: "bullet", indentLevel: 0 },
        { listType: "bullet", indentLevel: 1 },
        { listType: "bullet", indentLevel: 0 },
      ],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>");
  });

  it("a list run followed by plain paragraphs mixes <ul> and <br>-joined text", () => {
    const node = textNode({
      text: "title\nitem one\nitem two",
      paragraphs: [{}, { listType: "bullet" }, { listType: "bullet" }],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("title");
    expect(html).toContain("<ul><li>item one</li><li>item two</li></ul>");
  });

  it("a type change at the same level closes and reopens the list (bullet then number)", () => {
    const node = textNode({
      text: "a\nb",
      paragraphs: [{ listType: "bullet" }, { listType: "number" }],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("<ul><li>a</li></ul><ol><li>b</li></ol>");
  });

  it("escapes HTML-significant characters inside list item text", () => {
    const node = textNode({
      text: "<b>x</b> & y",
      paragraphs: [{ listType: "bullet" }],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt; &amp; y");
    expect(html).not.toContain("<b>x</b>");
  });
});
