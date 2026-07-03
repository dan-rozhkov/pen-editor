import { describe, expect, it } from "vitest";
import { serializePublicPenDocument } from "@/utils/publicPenExport";
import type { RectNode } from "@/types/scene";

function baseRect(overrides: Partial<RectNode>): RectNode {
  return {
    id: "rect-1",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    ...overrides,
  };
}

function exportNodes(nodes: RectNode[]) {
  const json = serializePublicPenDocument(nodes, [], "light");
  return JSON.parse(json);
}

describe("publicPenExport effects", () => {
  it("exports the effects stack with shadow and blur entries", () => {
    const node = baseRect({
      effects: [
        {
          type: "shadow",
          shadowType: "outer",
          color: "#00000040",
          offset: { x: 0, y: 2 },
          blur: 4,
          spread: 0,
        },
        { type: "blur", radius: 8 },
      ],
    });

    const doc = exportNodes([node]);
    const exported = doc.children[0];

    expect(exported.effect).toEqual([
      {
        type: "shadow",
        shadowType: "outer",
        offset: { x: 0, y: 2 },
        spread: 0,
        blur: 4,
        color: "#00000040",
      },
      { type: "blur", radius: 8 },
    ]);
  });

  it("preserves visible: false and still exports legacy single effect", () => {
    const nodeA = baseRect({
      id: "rect-a",
      effects: [{ type: "blur", radius: 8, visible: false }],
    });
    const nodeB = baseRect({
      id: "rect-b",
      effect: {
        type: "shadow",
        shadowType: "outer",
        color: "#00000040",
        offset: { x: 0, y: 2 },
        blur: 4,
        spread: 0,
      },
    });

    const doc = exportNodes([nodeA, nodeB]);
    const exportedA = doc.children[0];
    const exportedB = doc.children[1];

    expect(exportedA.effect).toEqual([{ type: "blur", radius: 8, visible: false }]);
    expect(exportedB.effect).toEqual([
      {
        type: "shadow",
        shadowType: "outer",
        offset: { x: 0, y: 2 },
        spread: 0,
        blur: 4,
        color: "#00000040",
      },
    ]);
  });
});
