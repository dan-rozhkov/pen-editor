import { describe, it, expect } from "vitest";
import { resolveSlideOrder } from "@/utils/slideOrder";
import type { FlatSceneNode } from "@/types/scene";

function frame(id: string): FlatSceneNode {
  return {
    id,
    type: "frame",
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  } as unknown as FlatSceneNode;
}

function rect(id: string): FlatSceneNode {
  return {
    id,
    type: "rectangle",
    name: id,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
  } as unknown as FlatSceneNode;
}

describe("resolveSlideOrder", () => {
  it("returns slideOrder's order for existing top-level frames", () => {
    const nodesById = { A: frame("A"), B: frame("B"), C: frame("C") };
    const rootIds = ["A", "B", "C"];
    expect(resolveSlideOrder(nodesById, rootIds, ["C", "A", "B"])).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("appends new top-level frames (not in slideOrder) in rootIds order", () => {
    const nodesById = { A: frame("A"), B: frame("B"), C: frame("C") };
    const rootIds = ["A", "B", "C"];
    expect(resolveSlideOrder(nodesById, rootIds, ["B"])).toEqual([
      "B",
      "A",
      "C",
    ]);
  });

  it("drops ids from slideOrder that no longer exist (deleted)", () => {
    const nodesById = { A: frame("A"), C: frame("C") };
    const rootIds = ["A", "C"];
    expect(resolveSlideOrder(nodesById, rootIds, ["B", "C", "A"])).toEqual([
      "C",
      "A",
    ]);
  });

  it("excludes non-frame top-level nodes even if listed in slideOrder", () => {
    const nodesById = { A: frame("A"), R: rect("R") };
    const rootIds = ["A", "R"];
    expect(resolveSlideOrder(nodesById, rootIds, ["R", "A"])).toEqual(["A"]);
  });

  it("excludes frames that are no longer top-level (nested under another root)", () => {
    const nodesById = { A: frame("A"), B: frame("B") };
    const rootIds = ["A"]; // B is no longer a root id (e.g. moved into A)
    expect(resolveSlideOrder(nodesById, rootIds, ["B", "A"])).toEqual(["A"]);
  });

  it("returns an empty array when there are no top-level frames", () => {
    expect(resolveSlideOrder({}, [], [])).toEqual([]);
  });

  it("falls back to rootIds order entirely when slideOrder is empty", () => {
    const nodesById = { A: frame("A"), B: frame("B") };
    const rootIds = ["B", "A"];
    expect(resolveSlideOrder(nodesById, rootIds, [])).toEqual(["B", "A"]);
  });

  it("de-duplicates ids that appear more than once in slideOrder", () => {
    const nodesById = { A: frame("A"), B: frame("B") };
    const rootIds = ["A", "B"];
    expect(resolveSlideOrder(nodesById, rootIds, ["A", "A", "B"])).toEqual([
      "A",
      "B",
    ]);
  });
});
