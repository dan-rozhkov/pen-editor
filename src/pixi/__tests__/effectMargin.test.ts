import { describe, expect, it } from "vitest";
import { effectMargin, nodeEffectMargin, subtreeEffectMargin } from "../effectMargin";
import type { Effect } from "@/types/scene";

describe("effectMargin", () => {
  it("returns 0 for no effects", () => {
    expect(effectMargin(undefined)).toBe(0);
    expect(effectMargin([])).toBe(0);
  });

  it("an outer shadow contributes |offset| + blur + spread", () => {
    const effects: Effect[] = [
      { type: "shadow", shadowType: "outer", color: "#00000080", offset: { x: 4, y: -6 }, blur: 10, spread: 2 },
    ];
    // max(|4|, |-6|) + 10 + 2 = 18
    expect(effectMargin(effects)).toBe(18);
  });

  it("an inner shadow contributes 0 (clipped to the node's own shape)", () => {
    const effects: Effect[] = [
      { type: "shadow", shadowType: "inner", color: "#00000080", offset: { x: 20, y: 20 }, blur: 30, spread: 5 },
    ];
    expect(effectMargin(effects)).toBe(0);
  });

  it("a layer blur contributes its radius", () => {
    const effects: Effect[] = [{ type: "blur", radius: 12 }];
    expect(effectMargin(effects)).toBe(12);
  });

  it("a background blur contributes 0 (baked masked to the node's own shape)", () => {
    const effects: Effect[] = [{ type: "background-blur", radius: 40 }];
    expect(effectMargin(effects)).toBe(0);
  });

  it("takes the max across multiple effects, ignoring invisible ones", () => {
    const effects: Effect[] = [
      { type: "shadow", shadowType: "outer", color: "#00000080", offset: { x: 0, y: 0 }, blur: 4, spread: 0 },
      { type: "shadow", shadowType: "outer", color: "#00000080", offset: { x: 0, y: 0 }, blur: 100, spread: 0, visible: false },
      { type: "blur", radius: 9 },
    ];
    expect(effectMargin(effects)).toBe(9);
  });

  it("no effect fields at all -> 0, unchanged rect semantics", () => {
    expect(nodeEffectMargin({})).toBe(0);
  });

  it("nodeEffectMargin reads a node's effects field", () => {
    const node = {
      effects: [
        { type: "shadow" as const, shadowType: "outer" as const, color: "#00000080", offset: { x: 5, y: 5 }, blur: 8, spread: 0 },
      ],
    };
    expect(nodeEffectMargin(node)).toBe(13);
  });
});

describe("subtreeEffectMargin", () => {
  it("returns 0 for a subtree with no effects anywhere", () => {
    const nodesById = { root: {}, child: {} };
    const childrenById = { root: ["child"], child: [] };
    expect(subtreeEffectMargin(nodesById, childrenById, "root")).toBe(0);
  });

  it("finds the max margin among a nested descendant, not just the root", () => {
    const nodesById = {
      root: {},
      child: {},
      grandchild: {
        effects: [
          { type: "shadow" as const, shadowType: "outer" as const, color: "#00000080", offset: { x: 0, y: 0 }, blur: 24, spread: 0 },
        ],
      },
    };
    const childrenById = { root: ["child"], child: ["grandchild"], grandchild: [] };
    expect(subtreeEffectMargin(nodesById, childrenById, "root")).toBe(24);
  });

  it("a missing root id contributes 0 but descendants (if reachable) still count", () => {
    const nodesById = {
      child: {
        effects: [{ type: "blur" as const, radius: 7 }],
      },
    };
    const childrenById = { root: ["child"], child: [] };
    expect(subtreeEffectMargin(nodesById, childrenById, "root")).toBe(7);
  });
});
