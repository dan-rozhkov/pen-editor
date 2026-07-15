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

  it("reverses the authored path direction and remaps startOffset when flip is set", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      text1: pathTextNode({
        textPath: { ...pathTextNode().textPath!, startOffset: 0.25, flip: true },
      }),
    };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    // Reversed straight line: M200,0 L0,0
    expect(svg).toMatch(/<path id="pen-svg-textpath-\d+" d="M200,0 L0,0" fill="none"\/>/);
    // 1 - 0.25 = 0.75 -> 75%
    expect(svg).toContain('startOffset="75.000%"');
    // flip also swaps the effective side (left -> right here).
    expect(svg).toContain('dominant-baseline="hanging"');
  });

  it("does not wrap glyphs in <tspan> for path text", () => {
    const nodesById: Record<string, FlatSceneNode> = { text1: pathTextNode({ text: "a\nb" }) };
    const { svg } = convertDesignNodesToSvg("text1", nodesById, {});
    expect(svg).not.toContain("<tspan");
  });
});
