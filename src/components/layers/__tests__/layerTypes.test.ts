import { describe, it, expect } from "vitest";
import {
  flattenLayers,
  getLayerKey,
  getDisplayName,
} from "../layerTypes";
import type { FlattenedLayer } from "../layerTypes";
import type { SceneNode } from "@/types/scene";

function node(
  id: string,
  type: string,
  extra: Partial<SceneNode> = {},
): SceneNode {
  return { id, type, x: 0, y: 0, width: 10, height: 10, ...extra } as SceneNode;
}

describe("getDisplayName", () => {
  it("uses the node name when present", () => {
    expect(getDisplayName({ name: "Header", type: "frame" })).toBe("Header");
  });

  it("falls back to a capitalized type when unnamed", () => {
    expect(getDisplayName({ type: "rect" })).toBe("Rect");
    expect(getDisplayName({ name: "", type: "text" })).toBe("Text");
  });
});

describe("getLayerKey", () => {
  it("returns the node id for ordinary layers", () => {
    const layer: FlattenedLayer = { node: node("n1", "rect"), depth: 0, parentId: null };
    expect(getLayerKey(layer)).toBe("n1");
  });

  it("returns instanceId:path for ref-descendant layers", () => {
    const layer: FlattenedLayer = {
      node: node("child", "rect"),
      depth: 1,
      parentId: null,
      instanceId: "ref1",
      descendantPath: "a/b",
    };
    expect(getLayerKey(layer)).toBe("ref1:a/b");
  });
});

describe("flattenLayers", () => {
  it("returns only top-level nodes when nothing is expanded", () => {
    const frame = node("a", "frame", {
      name: "A",
      children: [node("c1", "rect"), node("c2", "text")],
    } as Partial<SceneNode>);
    const b = node("b", "rect");

    const flat = flattenLayers([frame, b], new Set());
    expect(flat.map((l) => l.node.id)).toEqual(["a", "b"]);
    expect(flat.map((l) => l.depth)).toEqual([0, 0]);
  });

  it("expands a container's children in reverse order with depth + parentId", () => {
    const frame = node("a", "frame", {
      name: "A",
      children: [node("c1", "rect"), node("c2", "text")],
    } as Partial<SceneNode>);
    const b = node("b", "rect");

    const flat = flattenLayers([frame, b], new Set(["a"]));
    // children are emitted bottom-to-top (reverse of tree order)
    expect(flat.map((l) => l.node.id)).toEqual(["a", "c2", "c1", "b"]);
    expect(flat.map((l) => l.depth)).toEqual([0, 1, 1, 0]);
    expect(flat.map((l) => l.parentId)).toEqual([null, "a", "a", null]);
  });

  it("recurses into nested expanded containers", () => {
    const group = node("g", "group", {
      children: [node("d1", "rect")],
    } as Partial<SceneNode>);
    const frame = node("a", "frame", {
      children: [node("c1", "rect"), group],
    } as Partial<SceneNode>);

    const flat = flattenLayers([frame], new Set(["a", "g"]));
    expect(flat.map((l) => l.node.id)).toEqual(["a", "g", "d1", "c1"]);
    expect(flat.map((l) => l.depth)).toEqual([0, 1, 2, 1]);
  });

  it("does not recurse into a collapsed nested container", () => {
    const group = node("g", "group", {
      children: [node("d1", "rect")],
    } as Partial<SceneNode>);
    const frame = node("a", "frame", {
      children: [group],
    } as Partial<SceneNode>);

    // 'a' expanded but 'g' collapsed -> d1 is hidden
    const flat = flattenLayers([frame], new Set(["a"]));
    expect(flat.map((l) => l.node.id)).toEqual(["a", "g"]);
  });
});
