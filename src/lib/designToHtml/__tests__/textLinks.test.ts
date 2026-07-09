import { describe, it, expect } from "vitest";
import { convertNodeToHtml, type ConversionContext } from "../convertNode";
import { generateTextStyles } from "../styleGeneration";
import { TEXT_LINK_COLOR } from "@/lib/textLink";
import type { FlatSceneNode, TextNode } from "@/types/scene";

function textNode(overrides: Partial<TextNode> = {}): FlatSceneNode {
  return {
    id: "t1",
    type: "text",
    x: 0,
    y: 0,
    width: 200,
    height: 40,
    text: "Sign up now",
    ...overrides,
  } as unknown as FlatSceneNode;
}

function makeCtx(node: FlatSceneNode): ConversionContext {
  return { nodesById: { [node.id]: node }, childrenById: {}, allNodes: [] };
}

describe("designToHtml: text links", () => {
  it("wraps a plain linked span in an <a href> with target=_blank and rel=noopener", () => {
    const node = textNode({ link: { url: "https://example.com/signup" } });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toMatch(
      /^<a href="https:\/\/example\.com\/signup" target="_blank" rel="noopener"><span[^>]*>Sign up now<\/span><\/a>$/,
    );
  });

  it("includes a title attribute when the link has one", () => {
    const node = textNode({ link: { url: "https://example.com", title: "Go to example" } });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain('href="https://example.com" title="Go to example" target="_blank"');
  });

  it("escapes quotes/HTML in the url and title", () => {
    const node = textNode({
      link: { url: 'https://example.com/?q="x"', title: 'a "quoted" title' },
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain('href="https://example.com/?q=&quot;x&quot;"');
    expect(html).toContain('title="a &quot;quoted&quot; title"');
  });

  it("does not wrap in <a> when there is no link", () => {
    const node = textNode();
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).not.toContain("<a ");
  });

  it("also wraps the block (div) shape used by fixed-height/vertical-align text", () => {
    const node = textNode({
      link: { url: "https://example.com" },
      textWidthMode: "fixed-height",
      height: 100,
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html.startsWith('<a href="https://example.com"')).toBe(true);
    expect(html).toContain("<div");
  });

  it("also wraps the list/paragraph-spaced block shape", () => {
    const node = textNode({
      link: { url: "https://example.com" },
      text: "one\ntwo",
      paragraphs: [{ listType: "bullet" }, { listType: "bullet" }],
    });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html.startsWith('<a href="https://example.com"')).toBe(true);
    expect(html).toContain("<ul>");
  });
});

describe("designToHtml generateTextStyles: link decoration/color", () => {
  it("forces an underline for a linked node with underline unset", () => {
    const styles = generateTextStyles(textNode({ link: { url: "https://example.com" } }) as TextNode);
    expect(styles["text-decoration"]).toBe("underline");
  });

  it("does not duplicate underline when both underline and link are set", () => {
    const styles = generateTextStyles(
      textNode({ link: { url: "https://example.com" }, underline: true }) as TextNode,
    );
    expect(styles["text-decoration"]).toBe("underline");
  });

  it("combines link-forced underline with strikethrough", () => {
    const styles = generateTextStyles(
      textNode({ link: { url: "https://example.com" }, strikethrough: true }) as TextNode,
    );
    expect(styles["text-decoration"]).toBe("underline line-through");
  });

  it("defaults the color to TEXT_LINK_COLOR for a linked node with no fill", () => {
    const node = textNode({ link: { url: "https://example.com" } });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain(`color:${TEXT_LINK_COLOR}`);
  });

  it("respects an explicit fill over the default link color", () => {
    const node = textNode({ link: { url: "https://example.com" }, fill: "#ff0000" });
    const html = convertNodeToHtml(node.id, makeCtx(node), undefined, true);
    expect(html).toContain("color:#ff0000");
    expect(html).not.toContain(TEXT_LINK_COLOR);
  });
});
