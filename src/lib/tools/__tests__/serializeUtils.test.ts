import { describe, expect, it } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { serializeNodeToDepth } from "../serializeUtils";

describe("serializeNodeToDepth — paint-level variable bindings", () => {
  const fills = [
    { id: "a", type: "solid" as const, color: "#000000", colorBinding: { variableId: "var1" } },
    { id: "b", type: "solid" as const, color: "#ffffff" },
  ];

  function makeNodesById(): Record<string, FlatSceneNode> {
    return {
      rect1: {
        id: "rect1",
        type: "rectangle",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fills,
      } as unknown as FlatSceneNode,
    };
  }

  it("resolves bound paint colors when resolveVars is set", () => {
    const nodesById = makeNodesById();
    const result = serializeNodeToDepth("rect1", nodesById, {}, 1, {
      resolveVars: true,
      variableLookup: { var1: "#123456" },
    });

    expect(result).not.toBeNull();
    const resultFills = result!.fills as typeof fills;
    expect(resultFills[0].color).toBe("#123456");
    expect(resultFills[1].color).toBe("#ffffff");

    // Original store object must remain unmutated.
    expect(nodesById.rect1.fills).toEqual(fills);
    expect((nodesById.rect1.fills as typeof fills)[0].color).toBe("#000000");
  });

  it("passes fills through by reference when resolveVars is unset", () => {
    const nodesById = makeNodesById();
    const result = serializeNodeToDepth("rect1", nodesById, {}, 1);

    expect(result).not.toBeNull();
    expect(result!.fills).toBe(nodesById.rect1.fills);
  });
});
