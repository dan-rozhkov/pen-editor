import { describe, it, expect } from "vitest";
import { buildSvgForSelection } from "../buildSelectionSvg";
import type { FlatSceneNode, RectNode } from "@/types/scene";

function rect(id: string, extra: Partial<RectNode> = {}): RectNode {
  return {
    id,
    type: "rect",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    fill: "#ff0000",
    ...extra,
  } as RectNode;
}

describe("buildSvgForSelection", () => {
  it("returns valid SVG for a single-node selection", () => {
    const nodesById: Record<string, FlatSceneNode> = { r1: rect("r1", { width: 120, height: 60 }) };
    const { svg, warnings } = buildSvgForSelection(["r1"], nodesById, {}, {});

    expect(warnings).toEqual([]);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="120" height="60"/);
    expect(svg).toContain("</svg>");
    expect(svg).toContain("<rect");
  });

  it("combines a multi-node selection into one SVG sized to their bounding box", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      a: rect("a", { x: 0, y: 0, width: 50, height: 50, fill: "#ff0000" }),
      b: rect("b", { x: 100, y: 20, width: 40, height: 40, fill: "#00ff00" }),
    };
    const { svg, warnings } = buildSvgForSelection(["a", "b"], nodesById, {}, {});

    expect(warnings).toEqual([]);
    // bbox: x in [0,140], y in [0,60] -> width 140, height 60
    expect(svg).toContain('width="140" height="60"');
    expect(svg).toContain('translate(0 0)');
    expect(svg).toContain('translate(100 20)');
    expect((svg.match(/<rect/g) ?? []).length).toBe(2);
  });

  it("uses each node's ABSOLUTE position (not parent-relative) when the selection spans different parents", () => {
    // "parent" is a frame at absolute (10, 10). "a" is nested inside it at
    // parent-relative (5, 5) -> absolute (15, 15). "b" is a top-level node
    // at (100, 20) -> absolute equals its own x/y since it has no parent.
    const nodesById: Record<string, FlatSceneNode> = {
      parent: rect("parent", { x: 10, y: 10, width: 200, height: 200 }),
      a: rect("a", { x: 5, y: 5, width: 50, height: 50, fill: "#ff0000" }),
      b: rect("b", { x: 100, y: 20, width: 40, height: 40, fill: "#00ff00" }),
    };
    const childrenById: Record<string, string[]> = { parent: ["a"] };
    const parentById: Record<string, string | null> = { parent: null, a: "parent", b: null };

    const { svg, warnings } = buildSvgForSelection(["a", "b"], nodesById, childrenById, parentById);

    expect(warnings).toEqual([]);
    // absolute positions: a=(15,15) size 50x50 -> extends to (65,65);
    // b=(100,20) size 40x40 -> extends to (140,60)
    // bbox: x in [15,140], y in [15,65] -> width 125, height 50
    expect(svg).toContain('width="125" height="50"');
    // a translated by (15-15, 15-15) = (0, 0)
    expect(svg).toContain('translate(0 0)');
    // b translated by (100-15, 20-15) = (85, 5)
    expect(svg).toContain('translate(85 5)');
    expect((svg.match(/<rect/g) ?? []).length).toBe(2);
  });

  it("pushes a warning for each missing/stale id but still returns SVG for the resolvable nodes", () => {
    const nodesById: Record<string, FlatSceneNode> = {
      a: rect("a", { x: 0, y: 0, width: 50, height: 50 }),
      b: rect("b", { x: 100, y: 20, width: 40, height: 40 }),
    };
    const { svg, warnings } = buildSvgForSelection(["a", "missing-1", "b", "missing-2"], nodesById, {}, {});

    expect(warnings).toEqual(["Node not found: missing-1", "Node not found: missing-2"]);
    expect(svg).toContain("<svg");
    expect((svg.match(/<rect/g) ?? []).length).toBe(2);
  });

  it("returns an empty result with a warning for an empty selection", () => {
    const { svg, warnings } = buildSvgForSelection([], {}, {}, {});
    expect(svg).toBe("");
    expect(warnings.length).toBeGreaterThan(0);
  });
});
