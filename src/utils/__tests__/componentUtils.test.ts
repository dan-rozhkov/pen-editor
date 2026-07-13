import { describe, it, expect } from "vitest";
import { getTopLevelFramesFlat } from "../componentUtils";
import type { FlatSceneNode } from "@/types/scene";

function frame(id: string, name: string): FlatSceneNode {
  return {
    id,
    type: "frame",
    name,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as unknown as FlatSceneNode;
}

function rect(id: string, name: string): FlatSceneNode {
  return {
    id,
    type: "rectangle",
    name,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  } as unknown as FlatSceneNode;
}

describe("getTopLevelFramesFlat", () => {
  it("returns an empty list when there are no root nodes", () => {
    expect(getTopLevelFramesFlat({}, [])).toEqual([]);
  });

  it("selects only frame nodes among the root ids, in rootIds order", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      f1: frame("f1", "Slide 1"),
      r1: rect("r1", "Floating rect"),
      f2: frame("f2", "Slide 2"),
    };
    const rootIds = ["f1", "r1", "f2"];

    const result = getTopLevelFramesFlat(nodesById, rootIds);

    expect(result.map((n) => n.id)).toEqual(["f1", "f2"]);
  });

  it("preserves rootIds order rather than sorting by position", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      // f2 is visually above/left of f1, but rootIds lists f1 first.
      f1: { ...frame("f1", "Slide 1"), x: 500, y: 500 },
      f2: { ...frame("f2", "Slide 2"), x: 0, y: 0 },
    };
    const rootIds = ["f1", "f2"];

    const result = getTopLevelFramesFlat(nodesById, rootIds);

    expect(result.map((n) => n.id)).toEqual(["f1", "f2"]);
  });

  it("excludes nested frames (only rootIds are considered)", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      f1: frame("f1", "Slide 1"),
      nested: frame("nested", "Nested frame"),
    };
    const rootIds = ["f1"]; // "nested" intentionally not a root id

    const result = getTopLevelFramesFlat(nodesById, rootIds);

    expect(result.map((n) => n.id)).toEqual(["f1"]);
  });

  it("ignores a root id that no longer resolves to a node", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      f1: frame("f1", "Slide 1"),
    };
    const rootIds = ["f1", "stale-id"];

    const result = getTopLevelFramesFlat(nodesById, rootIds);

    expect(result.map((n) => n.id)).toEqual(["f1"]);
  });
});
