import { describe, it, expect } from "vitest";
import { convertDesignNodesToSvg } from "../index";
import type { FlatSceneNode, TextNode } from "@/types/scene";

function pathTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "text1",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: "Hello",
    fontSize: 16,
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

describe("convertDesignNodesToSvg — text-on-path", () => {
  it("emits a <defs><path> and a <textPath> referencing it", () => {
    const nodesById: Record<string, FlatSceneNode> = { text1: pathTextNode() };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});

    expect(svg).toContain("<defs>");
    expect(svg).toMatch(/<path id="pen-svg-textpath-\d+" d="M0,0 L200,0" fill="none"\/>/);
    expect(svg).toMatch(/<textPath href="#pen-svg-textpath-\d+" startOffset="0(\.000)?%">Hello<\/textPath>/);
  });

  it("encodes startOffset as a percentage", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      text1: pathTextNode({ textPath: { ...pathTextNode().textPath!, startOffset: 0.25 } }),
    };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    expect(svg).toContain('startOffset="25.000%"');
  });

  it("uses dominant-baseline=hanging for side='right'", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      text1: pathTextNode({ textPath: { ...pathTextNode().textPath!, side: "right" } }),
    };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    expect(svg).toContain('dominant-baseline="hanging"');
  });

  it("reverses the authored path direction but leaves startOffset unchanged when flip is set", () => {
    // `startOffset` is a fraction along the effective (post-flip) direction
    // of travel, so it passes through as-is. An earlier version remapped it
    // to `1 - startOffset`, which combined with the default `startOffset: 0`
    // placed the whole string's start at the path's very end, rendering at
    // most one glyph before overflow cut the rest.
    const nodesById: Record<string, FlatSceneNode> = {
      text1: pathTextNode({
        textPath: { ...pathTextNode().textPath!, startOffset: 0.25, flip: true },
      }),
    };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    // Reversed straight line: M200,0 L0,0
    expect(svg).toMatch(/<path id="pen-svg-textpath-\d+" d="M200,0 L0,0" fill="none"\/>/);
    expect(svg).toContain('startOffset="25.000%"');
    // flip also swaps the effective side (left -> right here).
    expect(svg).toContain('dominant-baseline="hanging"');
  });

  it("renders the full string with flip:true and the default startOffset:0 (regression: the old 1 - startOffset remap pushed the whole string past the path's end)", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      text1: pathTextNode({
        textPath: { ...pathTextNode().textPath!, startOffset: 0, flip: true },
      }),
    };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    expect(svg).toContain('startOffset="0.000%"');
    expect(svg).toContain(">Hello<");
  });

  it("does not wrap glyphs in <tspan> for path text", () => {
    const nodesById: Record<string, FlatSceneNode> = { text1: pathTextNode({ text: "a\nb" }) };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    expect(svg).not.toContain("<tspan");
  });

  // Finding 1 regression: the closed-path (circle) case is the spec's
  // headline use case for text-on-a-path (badges, stamps) — flip must
  // reverse a closed contour's authored `Z`-closed path correctly, not just
  // an open 2-point line.
  it("reverses a closed (circular) path's direction but leaves startOffset unchanged when flip is set", () => {
    const r = 100;
    const k = 0.5522847498;
    const circlePoints = [
      { x: r, y: 0, handleOut: { x: r, y: r * k }, handleIn: { x: r, y: -r * k } },
      { x: 0, y: r, handleIn: { x: r * k, y: r }, handleOut: { x: -r * k, y: r } },
    ];
    const nodesById: Record<string, FlatSceneNode> = {
      text1: pathTextNode({
        textPath: { points: circlePoints, closed: true, startOffset: 0.2, side: "left", flip: true },
      }),
    };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});

    // Reversed anchor order (point 1 first, point 0 second) with
    // handleIn/handleOut swapped, still closed with "Z".
    expect(svg).toMatch(/<path id="pen-svg-textpath-\d+" d="M0,100 C[^"]+ Z" fill="none"\/>/);
    expect(svg).toContain('startOffset="20.000%"');
  });
});
