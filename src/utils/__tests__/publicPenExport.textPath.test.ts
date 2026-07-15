import { describe, expect, it } from "vitest";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import type { TextNode } from "@/types/scene";

function textPathNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: "text-1",
    type: "text",
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text: "Hello",
    textPath: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      closed: false,
      startOffset: 0.25,
      side: "right",
      flip: true,
    },
    ...overrides,
  } as TextNode;
}

function exportNodes(nodes: TextNode[]) {
  const json = serializePublicPenDocument(nodes, [], "light");
  return JSON.parse(json);
}

describe("publicPenExport textPath", () => {
  it("exports the path geometry and path metadata for a text-on-path node", () => {
    const doc = exportNodes([textPathNode()]);
    const exported = doc.children[0];

    expect(exported.path).toBe("M0,0 L100,0");
    expect(exported.pathStartOffset).toBe(0.25);
    expect(exported.pathSide).toBe("right");
    expect(exported.pathFlip).toBe(true);
  });

  it("omits path fields entirely for a plain (non-path) text node", () => {
    const doc = exportNodes([textPathNode({ textPath: undefined })]);
    const exported = doc.children[0];

    expect(exported.path).toBeUndefined();
    expect(exported.pathStartOffset).toBeUndefined();
    expect(exported.pathSide).toBeUndefined();
    expect(exported.pathFlip).toBeUndefined();
  });

  it("omits pathFlip when flip is not set (default false)", () => {
    const doc = exportNodes([
      textPathNode({ textPath: { ...textPathNode().textPath!, flip: undefined } }),
    ]);
    const exported = doc.children[0];
    expect(exported.pathFlip).toBeUndefined();
  });
});
