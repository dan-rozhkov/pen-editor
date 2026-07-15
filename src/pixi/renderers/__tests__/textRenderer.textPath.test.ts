import { describe, expect, it } from "vitest";
import { Container } from "pixi.js";
import { createTextContainer, updateTextContainer } from "../textRenderer";
import type { TextNode } from "@/types/scene";

function pathTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "t1",
    type: "text",
    name: "T",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: "Hello",
    fontSize: 16,
    fontFamily: "Arial",
    textPath: {
      points: [
        { x: 0, y: 0 },
        { x: 200, y: 0 },
      ],
      closed: false,
      startOffset: 0,
      side: "left",
    },
    ...overrides,
  } as TextNode;
}

function pathRoot(container: Container): Container | undefined {
  return container.getChildByLabel("text-path-root") as Container | undefined;
}

describe("createTextContainer — text-on-path", () => {
  it("renders one glyph Text object per character", () => {
    const node = pathTextNode();
    const container = createTextContainer(node);
    const root = pathRoot(container);
    expect(root).toBeDefined();
    // "Hello" = 5 glyphs, all fit within a 200px-long straight line at fontSize 16.
    const glyphs = root!.children.filter((c) => c.label?.startsWith("text-path-glyph"));
    expect(glyphs.length).toBe(5);
  });

  it("positions glyphs along the path with increasing x for a straight horizontal line", () => {
    const node = pathTextNode();
    const container = createTextContainer(node);
    const root = pathRoot(container)!;
    const glyphs = root.children.filter((c) => c.label?.startsWith("text-path-glyph"));
    for (let i = 1; i < glyphs.length; i++) {
      expect(glyphs[i].x).toBeGreaterThan(glyphs[i - 1].x);
    }
    // A horizontal line has zero tangent rotation.
    for (const g of glyphs) {
      expect(g.rotation).toBeCloseTo(0, 5);
    }
  });

  it("does not render glyphs whose start position is past the path's end (overflow)", () => {
    const node = pathTextNode({
      text: "This text is way too long to fit on a short path segment",
      textPath: {
        points: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
        ],
        closed: false,
        startOffset: 0,
        side: "left",
      },
    });
    const container = createTextContainer(node);
    const root = pathRoot(container)!;
    const glyphs = root.children.filter((c) => c.label?.startsWith("text-path-glyph"));
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.length).toBeLessThan(node.text.length);
  });

  it("honors startOffset by shifting the first glyph forward along the path", () => {
    const base = pathTextNode();
    const offsetNode = pathTextNode({ textPath: { ...base.textPath!, startOffset: 0.25 } });

    const baseContainer = createTextContainer(base);
    const offsetContainer = createTextContainer(offsetNode);

    const baseFirst = pathRoot(baseContainer)!.children.find((c) => c.label === "text-path-glyph-0")!;
    const offsetFirst = pathRoot(offsetContainer)!.children.find((c) => c.label === "text-path-glyph-0")!;

    expect(offsetFirst.x).toBeGreaterThan(baseFirst.x);
  });

  it("flip swaps the effective side and rotates glyphs by PI", () => {
    const flipped = pathTextNode({ textPath: { ...pathTextNode().textPath!, flip: true } });
    const container = createTextContainer(flipped);
    const root = pathRoot(container)!;
    const first = root.children.find((c) => c.label === "text-path-glyph-0")!;
    expect(Math.abs(first.rotation)).toBeCloseTo(Math.PI, 5);
  });

  it("renders every glyph with flip:true and the default startOffset:0 (regression: flip used to remap startOffset -> 1, pushing the whole string past the path's end so only one glyph — or none — drew)", () => {
    const flipped = pathTextNode({ textPath: { ...pathTextNode().textPath!, flip: true, startOffset: 0 } });
    const container = createTextContainer(flipped);
    const root = pathRoot(container)!;
    const glyphs = root.children.filter((c) => c.label?.startsWith("text-path-glyph"));
    expect(glyphs).toHaveLength("Hello".length);
  });
});

describe("updateTextContainer — text-on-path diffing", () => {
  it("skips rebuild on a position-only (x/y) update", () => {
    const node = pathTextNode();
    const container = createTextContainer(node);
    const before = pathRoot(container);

    const moved = { ...node, x: 50, y: 20 };
    updateTextContainer(container, moved, node);

    expect(pathRoot(container)).toBe(before);
  });

  it("rebuilds when textPath itself changes (e.g. startOffset drag)", () => {
    const node = pathTextNode();
    const container = createTextContainer(node);
    const before = pathRoot(container);

    const updated = { ...node, textPath: { ...node.textPath!, startOffset: 0.5 } };
    updateTextContainer(container, updated, node);

    expect(pathRoot(container)).not.toBe(before);
  });

  it("rebuilds when text content changes", () => {
    const node = pathTextNode();
    const container = createTextContainer(node);
    const before = pathRoot(container);

    const updated = { ...node, text: "Bye" };
    updateTextContainer(container, updated, node);

    expect(pathRoot(container)).not.toBe(before);
  });

  it("rebuilds when transitioning from plain text to path mode", () => {
    const plain: TextNode = { ...pathTextNode(), textPath: undefined };
    const container = createTextContainer(plain);
    expect(pathRoot(container)).toBeNull();

    const onPath = pathTextNode();
    updateTextContainer(container, onPath, plain);

    expect(pathRoot(container)).toBeDefined();
  });

  it("rebuilds when transitioning from path mode back to plain text", () => {
    const onPath = pathTextNode();
    const container = createTextContainer(onPath);
    expect(pathRoot(container)).toBeDefined();

    const plain: TextNode = { ...onPath, textPath: undefined };
    updateTextContainer(container, plain, onPath);

    expect(pathRoot(container)).toBeNull();
    expect(container.getChildByLabel("text-content")).toBeDefined();
  });
});

describe("underline/strikethrough on a curve", () => {
  it("draws a text-decorations Graphics node when underline is set", () => {
    const node = pathTextNode({ underline: true });
    const container = createTextContainer(node);
    const root = pathRoot(container)!;
    expect(root.getChildByLabel("text-decorations")).toBeDefined();
  });

  it("draws no decorations Graphics node when neither underline nor strikethrough is set", () => {
    const node = pathTextNode();
    const container = createTextContainer(node);
    const root = pathRoot(container)!;
    expect(root.getChildByLabel("text-decorations")).toBeNull();
  });
});
