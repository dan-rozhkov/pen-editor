import { describe, expect, it } from "vitest";
import {
  buildTextPathNodeFromPath,
  findClosestPathNode,
  resolvePathAnchors,
  transformAnchors,
} from "../textPathHitTest";
import type { FlatSceneNode, PathNode } from "@/types/scene";

function pathNode(overrides: Partial<PathNode> = {}): PathNode {
  return {
    id: "path1",
    type: "path",
    x: 10,
    y: 20,
    width: 100,
    height: 0,
    geometry: "M0,0 L100,0",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
    closed: false,
    ...overrides,
  } as PathNode;
}

describe("resolvePathAnchors", () => {
  it("uses structured points when present", () => {
    const node = pathNode();
    const result = resolvePathAnchors(node);
    expect(result).toEqual({ points: node.points, closed: false });
  });

  it("derives anchors from geometry when points are absent (legacy path)", () => {
    const node = pathNode({ points: undefined, closed: undefined, geometry: "M0,0 L50,0 L50,50" });
    const result = resolvePathAnchors(node);
    expect(result).not.toBeNull();
    expect(result!.points.map((p) => [p.x, p.y])).toEqual([
      [0, 0],
      [50, 0],
      [50, 50],
    ]);
    expect(result!.closed).toBe(false);
  });

  it("returns null for unparsable geometry (e.g. an arc command)", () => {
    const node = pathNode({ points: undefined, geometry: "M0,0 A5,5 0 0 1 10,10" });
    expect(resolvePathAnchors(node)).toBeNull();
  });
});

describe("transformAnchors", () => {
  it("offsets points by the given origin with no scale when geometryBounds matches width/height", () => {
    const node: Pick<PathNode, "width" | "height" | "geometryBounds"> = { width: 100, height: 50 };
    const result = transformAnchors(node, { x: 10, y: 20 }, [{ x: 0, y: 0 }, { x: 100, y: 50 }]);
    expect(result).toEqual([
      { x: 10, y: 20, handleIn: undefined, handleOut: undefined },
      { x: 110, y: 70, handleIn: undefined, handleOut: undefined },
    ]);
  });

  it("bakes in a non-uniform scale from geometryBounds", () => {
    // geometryBounds is half the node's width/height -> scale factor 2.
    const node: Pick<PathNode, "width" | "height" | "geometryBounds"> = {
      width: 200,
      height: 100,
      geometryBounds: { x: 0, y: 0, width: 100, height: 50 },
    };
    const result = transformAnchors(node, { x: 0, y: 0 }, [{ x: 50, y: 25 }]);
    expect(result).toEqual([{ x: 100, y: 50, handleIn: undefined, handleOut: undefined }]);
  });

  it("transforms handleIn/handleOut alongside the anchor point", () => {
    const node: Pick<PathNode, "width" | "height" | "geometryBounds"> = { width: 10, height: 10 };
    const result = transformAnchors(node, { x: 5, y: 5 }, [
      { x: 0, y: 0, handleOut: { x: 1, y: 1 } },
    ]);
    expect(result[0].handleOut).toEqual({ x: 6, y: 6 });
  });
});

describe("findClosestPathNode", () => {
  const nodesById: Record<string, FlatSceneNode> = {
    path1: pathNode({ id: "path1", x: 0, y: 0 }),
    notAPath: { id: "notAPath", type: "rect", x: 0, y: 0, width: 10, height: 10 } as FlatSceneNode,
  };
  const getAbsPos = (id: string) => (nodesById[id] ? { x: nodesById[id].x, y: nodesById[id].y } : null);

  it("finds a path node within the distance threshold", () => {
    const hit = findClosestPathNode(50, 5, nodesById, getAbsPos, 10);
    expect(hit?.nodeId).toBe("path1");
    expect(hit?.distance).toBeCloseTo(5, 1);
  });

  it("returns null when nothing is within the threshold", () => {
    const hit = findClosestPathNode(50, 100, nodesById, getAbsPos, 10);
    expect(hit).toBeNull();
  });

  it("ignores non-path nodes", () => {
    const hit = findClosestPathNode(5, 5, nodesById, getAbsPos, 100);
    expect(hit?.nodeId).toBe("path1");
  });
});

describe("buildTextPathNodeFromPath", () => {
  it("copies geometry into textPath.points, normalized to the node's local box", () => {
    const node = pathNode({ x: 5, y: 5, width: 100, height: 1 });
    const text = buildTextPathNodeFromPath(node, "new-id");

    expect(text.id).toBe("new-id");
    expect(text.type).toBe("text");
    expect(text.x).toBe(5);
    expect(text.y).toBe(5);
    expect(text.textPath).toBeDefined();
    expect(text.textPath!.points).toEqual([
      { x: 0, y: 0, handleIn: undefined, handleOut: undefined },
      { x: 100, y: 0, handleIn: undefined, handleOut: undefined },
    ]);
    expect(text.textPath!.startOffset).toBe(0);
    expect(text.textPath!.side).toBe("left");
    expect(text.textPath!.closed).toBe(false);
  });

  it("migrates the path's fill onto the text node", () => {
    const node = pathNode({ fill: "#ff0000", fillOpacity: 0.5 });
    const text = buildTextPathNodeFromPath(node, "new-id");
    expect(text.fill).toBe("#ff0000");
    expect(text.fillOpacity).toBe(0.5);
  });

  it("falls back to the stroke color when the path has no fill (stroke-only path)", () => {
    const node = pathNode({ fill: undefined, pathStroke: { fill: "#00ff00", thickness: 2 } });
    const text = buildTextPathNodeFromPath(node, "new-id");
    expect(text.fill).toBe("#00ff00");
  });

  it("migrates effects onto the text node", () => {
    const node = pathNode({
      effects: [{ type: "blur", radius: 4 }],
    });
    const text = buildTextPathNodeFromPath(node, "new-id");
    expect(text.effects).toEqual([{ type: "blur", radius: 4 }]);
  });

  it("derives anchors from geometry when the path has no structured points", () => {
    const node = pathNode({ points: undefined, closed: undefined, geometry: "M0,0 L10,0 L10,10 Z" });
    const text = buildTextPathNodeFromPath(node, "new-id");
    expect(text.textPath!.points.length).toBe(3);
    expect(text.textPath!.closed).toBe(true);
  });

  // Finding 4 regression: `fills: []` (fills explicitly cleared, e.g. by
  // removing the last fill layer in the UI) is a truthy array. A plain
  // `pathNode.fills ?` truthiness check treats it as "has a fill", copies
  // the empty array onto the new text node, and never falls back to the
  // stroke color — producing text with no fill and no stroke that renders
  // invisible.
  it("falls back to the stroke color when fills is an empty array (stroke-only path with cleared fills)", () => {
    const node = pathNode({
      fill: undefined,
      fills: [],
      pathStroke: { fill: "#0000ff", thickness: 2 },
    });
    const text = buildTextPathNodeFromPath(node, "new-id");
    expect(text.fills).toBeUndefined();
    expect(text.fill).toBe("#0000ff");
  });
});
