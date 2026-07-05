import { describe, it, expect, beforeEach } from "vitest";
import { booleanOperation } from "@/lib/tools/booleanOperation";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { EllipseNode, PathNode, RectNode } from "@/types/scene";

function sceneState() {
  return useSceneStore.getState();
}

function seedOverlappingShapes(): void {
  const square: RectNode = {
    id: "square",
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  };
  const circle: EllipseNode = {
    id: "circle",
    type: "ellipse",
    x: 35,
    y: 35,
    width: 30,
    height: 30,
  };
  sceneState().addChildToFrame("frame1", square);
  sceneState().addChildToFrame("frame1", circle);
}

describe("boolean_operation tool", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    seedOverlappingShapes();
  });

  it("combines two nodeIds with the given operation and returns the new node id", async () => {
    const result = JSON.parse(
      await booleanOperation({ nodeIds: ["square", "circle"], operation: "union" }),
    );
    expect(result.resultNodeId).toBeTruthy();
    expect(result.operation).toBe("union");

    const path = sceneState().nodesById[result.resultNodeId] as PathNode;
    expect(path.type).toBe("path");
    expect(sceneState().nodesById["square"]).toBeUndefined();
    expect(sceneState().nodesById["circle"]).toBeUndefined();
  });

  it("accepts a JSON-string nodeIds payload", async () => {
    const result = JSON.parse(
      await booleanOperation({
        nodeIds: JSON.stringify(["square", "circle"]),
        operation: "subtract",
      }),
    );
    expect(result.resultNodeId).toBeTruthy();
  });

  it("errors on fewer than two nodeIds", async () => {
    const result = JSON.parse(await booleanOperation({ nodeIds: ["square"], operation: "union" }));
    expect(result.error).toBeTruthy();
  });

  it("errors on an invalid operation", async () => {
    const result = JSON.parse(
      await booleanOperation({ nodeIds: ["square", "circle"], operation: "nonsense" }),
    );
    expect(result.error).toBeTruthy();
  });

  it("errors when the store returns null (e.g. mismatched parents)", async () => {
    const result = JSON.parse(
      await booleanOperation({ nodeIds: ["square", "rect2"], operation: "union" }),
    );
    expect(result.error).toBeTruthy();
  });
});
