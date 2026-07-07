import { describe, it, expect } from "vitest";
import { applyTextProps } from "../styleApplication";
import type { TextNode } from "@/types/scene";

/**
 * Minimal CSSStyleDeclaration stub: applyTextProps only reads string
 * properties and guards every parse, so missing fields may be undefined.
 */
function styleStub(props: Record<string, string>): CSSStyleDeclaration {
  return props as unknown as CSSStyleDeclaration;
}

function textNode(): TextNode {
  return { id: "t1", type: "text", x: 0, y: 0, width: 100, height: 20, text: "hello" };
}

describe("applyTextProps — paragraphSpacing (from margin-bottom)", () => {
  it("maps a positive margin-bottom to paragraphSpacing", () => {
    const node = textNode();
    applyTextProps(node, styleStub({ marginBottom: "16px" }));
    expect(node.paragraphSpacing).toBe(16);
  });

  it("leaves paragraphSpacing unset when margin-bottom is 0/absent", () => {
    const node = textNode();
    applyTextProps(node, styleStub({ marginBottom: "0px" }));
    expect(node.paragraphSpacing).toBeUndefined();

    const node2 = textNode();
    applyTextProps(node2, styleStub({}));
    expect(node2.paragraphSpacing).toBeUndefined();
  });
});
