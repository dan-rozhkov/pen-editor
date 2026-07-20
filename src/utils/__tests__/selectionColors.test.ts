import { describe, expect, it } from "vitest";

import type { FlatSceneNode, PathNode, SceneNode } from "@/types/scene";
import {
  collectSelectionColors,
  normalizeColorKey,
  remapSelectionColor,
} from "@/utils/selectionColors";

function makeNode(props: Partial<FlatSceneNode>): SceneNode {
  return { id: "n1", type: "rect", x: 0, y: 0, width: 10, height: 10, ...props } as SceneNode;
}

describe("normalizeColorKey", () => {
  it("expands 3-digit shorthand and uppercases", () => {
    expect(normalizeColorKey("#f00")).toBe("#FF0000");
  });

  it("expands 4-digit shorthand (with alpha) and uppercases", () => {
    expect(normalizeColorKey("#f008")).toBe("#FF000088");
  });

  it("normalizes 6-digit hex casing", () => {
    expect(normalizeColorKey("#ff0000")).toBe("#FF0000");
  });

  it("normalizes 8-digit hex casing", () => {
    expect(normalizeColorKey("#ff000080")).toBe("#FF000080");
  });

  it("returns null for invalid/non-hex input", () => {
    expect(normalizeColorKey("red")).toBeNull();
    expect(normalizeColorKey("$--foreground")).toBeNull();
    expect(normalizeColorKey("#12345")).toBeNull();
    expect(normalizeColorKey("")).toBeNull();
  });
});

describe("collectSelectionColors", () => {
  it("returns [] for an empty selection", () => {
    expect(collectSelectionColors([], {}, {})).toEqual([]);
  });

  it("returns [] when nodes carry no colors", () => {
    const node = makeNode({ fill: undefined });
    expect(collectSelectionColors([node], { n1: node }, {})).toEqual([]);
  });

  it("dedups identical colors across nodes and counts occurrences", () => {
    const a = makeNode({ id: "a", fill: "#ff0000" });
    const b = makeNode({ id: "b", fill: "#FF0000" });
    const nodesById = { a, b };
    expect(collectSelectionColors([a, b], nodesById, {})).toEqual([
      { color: "#FF0000", count: 2 },
    ]);
  });

  it("walks descendants via childrenById (nested frame/group)", () => {
    const frame = makeNode({ id: "frame1", type: "frame", fill: "#111111" }) as SceneNode;
    const group = makeNode({ id: "group1", type: "group", fill: "#222222" }) as SceneNode;
    const rect = makeNode({ id: "rect1", type: "rect", fill: "#333333" });
    const nodesById = { frame1: frame, group1: group, rect1: rect };
    const childrenById = { frame1: ["group1"], group1: ["rect1"] };

    const colors = collectSelectionColors([frame], nodesById, childrenById);
    expect(colors.map((c) => c.color)).toEqual(["#111111", "#222222", "#333333"]);
  });

  it("picks up fills, legacy fill, stroke, pathStroke.fill, shadow effect, and legacy effect", () => {
    const withFills = makeNode({
      id: "fills-node",
      fills: [{ id: "p1", type: "solid", color: "#aaaaaa" }],
    });
    const legacyFill = makeNode({ id: "legacy-fill-node", fill: "#bbbbbb" });
    const strokeNode = makeNode({ id: "stroke-node", stroke: "#cccccc" });
    const pathNode = makeNode({
      id: "path-node",
      type: "path",
      geometry: "M0 0",
      pathStroke: { fill: "#dddddd" },
    } as Partial<PathNode>);
    const shadowNode = makeNode({
      id: "shadow-node",
      effects: [
        {
          type: "shadow",
          shadowType: "outer",
          color: "#eeeeee",
          offset: { x: 0, y: 0 },
          blur: 0,
          spread: 0,
        },
      ],
    });
    const legacyEffectNode = makeNode({
      id: "legacy-effect-node",
      effect: {
        type: "shadow",
        shadowType: "outer",
        color: "#111111",
        offset: { x: 0, y: 0 },
        blur: 0,
        spread: 0,
      },
    });

    const roots = [withFills, legacyFill, strokeNode, pathNode, shadowNode, legacyEffectNode];
    const nodesById = Object.fromEntries(roots.map((n) => [n.id, n]));

    const colors = collectSelectionColors(roots, nodesById, {});
    expect(colors.map((c) => c.color)).toEqual([
      "#AAAAAA",
      "#BBBBBB",
      "#CCCCCC",
      "#DDDDDD",
      "#EEEEEE",
      "#111111",
    ]);
  });

  it("picks up noise effect color and secondaryColor", () => {
    const noiseNode = makeNode({
      id: "noise-node",
      effects: [
        {
          type: "noise",
          noiseType: "duo",
          color: "#222222",
          secondaryColor: "#333333",
          noiseSize: 4,
          density: 0.5,
        },
      ],
    });
    const colors = collectSelectionColors([noiseNode], { "noise-node": noiseNode }, {});
    expect(colors.map((c) => c.color)).toEqual(["#222222", "#333333"]);
  });

  it("skips variable-bound fields (fill/stroke/effect colorBinding)", () => {
    const boundFill = makeNode({
      id: "bound-fill",
      fills: [{ id: "p1", type: "solid", color: "#ff0000", colorBinding: { variableId: "v1" } }],
    });
    const boundStroke = makeNode({
      id: "bound-stroke",
      stroke: "#00ff00",
      strokeBinding: { variableId: "v2" },
    });
    const boundEffect = makeNode({
      id: "bound-effect",
      effects: [
        {
          type: "shadow",
          shadowType: "outer",
          color: "#0000ff",
          colorBinding: { variableId: "v3" },
          offset: { x: 0, y: 0 },
          blur: 0,
          spread: 0,
        },
      ],
    });

    const roots = [boundFill, boundStroke, boundEffect];
    const nodesById = Object.fromEntries(roots.map((n) => [n.id, n]));
    expect(collectSelectionColors(roots, nodesById, {})).toEqual([]);
  });
});

describe("remapSelectionColor", () => {
  it("rewrites matching fills and spreads clearLegacyFillProps", () => {
    const node = makeNode({
      id: "n1",
      fill: "#ff0000",
      fillOpacity: 0.5,
      fills: undefined,
    });
    const result = remapSelectionColor([node], { n1: node }, {}, "#ff0000", "#00ff00");
    expect(result.n1).toMatchObject({
      fills: [expect.objectContaining({ type: "solid", color: "#00ff00" })],
      fill: undefined,
      fillOpacity: undefined,
      fillBinding: undefined,
      gradientFill: undefined,
      imageFill: undefined,
    });
  });

  it("rewrites stroke", () => {
    const node = makeNode({ id: "n1", stroke: "#ff0000" });
    const result = remapSelectionColor([node], { n1: node }, {}, "#ff0000", "#00ff00");
    expect(result.n1).toEqual({ stroke: "#00ff00" });
  });

  it("rewrites pathStroke.fill on path nodes", () => {
    const node = makeNode({
      id: "n1",
      type: "path",
      geometry: "M0 0",
      pathStroke: { fill: "#ff0000", thickness: 2 },
    } as Partial<PathNode>);
    const result = remapSelectionColor([node], { n1: node }, {}, "#ff0000", "#00ff00");
    expect(result.n1).toEqual({
      pathStroke: { fill: "#00ff00", thickness: 2 },
    });
  });

  it("rewrites shadow effect color, replacing the whole hex", () => {
    const node = makeNode({
      id: "n1",
      effects: [
        {
          type: "shadow",
          shadowType: "outer",
          color: "#00000040",
          offset: { x: 0, y: 4 },
          blur: 8,
          spread: 0,
        },
      ],
    });
    const result = remapSelectionColor([node], { n1: node }, {}, "#00000040", "#ff0000");
    expect(result.n1).toMatchObject({
      effects: [expect.objectContaining({ color: "#ff0000" })],
      effect: undefined,
    });
  });

  it("rewrites noise effect color and secondaryColor independently", () => {
    const node = makeNode({
      id: "n1",
      effects: [
        {
          type: "noise",
          noiseType: "duo",
          color: "#00000040",
          secondaryColor: "#ffffff40",
          noiseSize: 4,
          density: 0.5,
        },
      ],
    });
    const result = remapSelectionColor([node], { n1: node }, {}, "#00000040", "#ff0000");
    expect(result.n1).toMatchObject({
      effects: [expect.objectContaining({ color: "#ff0000", secondaryColor: "#ffffff40" })],
    });

    const result2 = remapSelectionColor([node], { n1: node }, {}, "#ffffff40", "#00ff00");
    expect(result2.n1).toMatchObject({
      effects: [expect.objectContaining({ color: "#00000040", secondaryColor: "#00ff00" })],
    });
  });

  it("leaves non-matching nodes out of the batch", () => {
    const matching = makeNode({ id: "match", fill: "#ff0000" });
    const nonMatching = makeNode({ id: "no-match", fill: "#00ff00" });
    const nodesById = { match: matching, "no-match": nonMatching };
    const result = remapSelectionColor(
      [matching, nonMatching],
      nodesById,
      {},
      "#ff0000",
      "#0000ff",
    );
    expect(Object.keys(result)).toEqual(["match"]);
  });

  it("preserves other paints/effects on a node with a partial match", () => {
    const node = makeNode({
      id: "n1",
      fills: [
        { id: "p1", type: "solid", color: "#ff0000" },
        { id: "p2", type: "solid", color: "#00ff00" },
      ],
    });
    const result = remapSelectionColor([node], { n1: node }, {}, "#ff0000", "#0000ff");
    expect(result.n1?.fills).toEqual([
      { id: "p1", type: "solid", color: "#0000ff" },
      { id: "p2", type: "solid", color: "#00ff00" },
    ]);
  });

  it("skips variable-bound fields when remapping", () => {
    const node = makeNode({
      id: "n1",
      fills: [{ id: "p1", type: "solid", color: "#ff0000", colorBinding: { variableId: "v1" } }],
    });
    const result = remapSelectionColor([node], { n1: node }, {}, "#ff0000", "#0000ff");
    expect(result.n1).toBeUndefined();
  });
});
