import { describe, it, expect } from "vitest";
import { applyTextProps } from "../styleApplication";
import type { TextNode } from "@/types/scene";

function makeTextNode(): TextNode {
  return { id: "t", type: "text", text: "x", x: 0, y: 0, width: 10, height: 10 };
}

describe("applyTextProps fontFallback", () => {
  it("captures the generic keyword from a font stack", () => {
    const node = makeTextNode();
    applyTextProps(node, { fontFamily: '"Plus Jakarta Sans", sans-serif' } as CSSStyleDeclaration);
    expect(node.fontFamily).toBe("Plus Jakarta Sans");
    expect(node.fontFallback).toBe("sans-serif");
  });

  it("captures monospace from a multi-family stack", () => {
    const node = makeTextNode();
    applyTextProps(node, { fontFamily: "JetBrains Mono, Menlo, monospace" } as CSSStyleDeclaration);
    expect(node.fontFallback).toBe("monospace");
  });

  it("leaves fontFallback unset for a single family", () => {
    const node = makeTextNode();
    applyTextProps(node, { fontFamily: "Inter" } as CSSStyleDeclaration);
    expect(node.fontFallback).toBeUndefined();
  });

  it("ignores a non-generic last family", () => {
    const node = makeTextNode();
    applyTextProps(node, { fontFamily: "Inter, Arial" } as CSSStyleDeclaration);
    expect(node.fontFallback).toBeUndefined();
  });
});
