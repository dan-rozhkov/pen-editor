import { describe, it, expect, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { resetStores } from "@/test/fixtures";

/**
 * Regression coverage for: "toggling visibility of a nested node does NOT
 * resize its auto-layout parent."  MODEL-LEVEL probe using
 * getNodeEffectiveSize + layoutStore.calculateLayoutForFrame.
 */

function effectiveHeightOf(id: string): number {
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const nodes = useSceneStore.getState().getNodes();
  const size = getNodeEffectiveSize(nodes, id, calc);
  return size!.height;
}

/** Column auto-layout frame, height=fit_content, gap 0, no padding, 3 rects h=40. */
function seedFlatColumn(): void {
  const col = {
    id: "col",
    type: "frame",
    name: "Col",
    x: 0,
    y: 0,
    width: 100,
    height: 120,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    sizing: { widthMode: "fixed", heightMode: "fit_content" },
  } as unknown as FlatSceneNode;

  const mk = (id: string) =>
    ({
      id,
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    } as unknown as FlatSceneNode);

  useSceneStore.setState({
    nodesById: { col, r1: mk("r1"), r2: mk("r2"), r3: mk("r3") },
    parentById: { col: null, r1: "col", r2: "col", r3: "col" },
    childrenById: { col: ["r1", "r2", "r3"] },
    rootIds: ["col"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

/**
 * Nested: outer column (fit height) -> inner frame (fit height, column, 2 rects h=40)
 *   plus a sibling rect h=40. Toggling a rect INSIDE the inner frame should
 *   shrink inner, which should shrink outer.
 */
function seedNestedColumn(): void {
  const outer = {
    id: "outer",
    type: "frame",
    name: "Outer",
    x: 0,
    y: 0,
    width: 100,
    height: 120,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    sizing: { widthMode: "fixed", heightMode: "fit_content" },
  } as unknown as FlatSceneNode;

  const inner = {
    id: "inner",
    type: "frame",
    name: "Inner",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    sizing: { widthMode: "fixed", heightMode: "fit_content" },
  } as unknown as FlatSceneNode;

  const mk = (id: string) =>
    ({
      id,
      type: "rect",
      x: 0,
      y: 0,
      width: 100,
      height: 40,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    } as unknown as FlatSceneNode);

  useSceneStore.setState({
    nodesById: {
      outer,
      inner,
      n1: mk("n1"),
      n2: mk("n2"),
      sibling: mk("sibling"),
    },
    parentById: {
      outer: null,
      inner: "outer",
      sibling: "outer",
      n1: "inner",
      n2: "inner",
    },
    childrenById: { outer: ["inner", "sibling"], inner: ["n1", "n2"] },
    rootIds: ["outer"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("visibility toggle resizes auto-layout parent (model level)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("[plain] fit-height column shrinks when a direct child is hidden", () => {
    seedFlatColumn();
    expect(effectiveHeightOf("col")).toBe(120);

    useSceneStore.getState().toggleVisibility("r2");

    expect(effectiveHeightOf("col")).toBe(80);
  });

  it("[nested] outer fit-height column shrinks when a grandchild is hidden", () => {
    seedNestedColumn();
    // inner = 80 (n1+n2), sibling = 40 => outer = 120
    expect(effectiveHeightOf("inner")).toBe(80);
    expect(effectiveHeightOf("outer")).toBe(120);

    useSceneStore.getState().toggleVisibility("n1");

    expect(effectiveHeightOf("inner")).toBe(40);
    expect(effectiveHeightOf("outer")).toBe(80);
  });

  it("[layoutStore] calculateLayoutForFrame recomputes flow positions when a child is hidden", () => {
    seedFlatColumn();
    // calculateLayoutForFrame expects a *tree* FrameNode. Pull from getNodes().
    const yOf = (arr: { id: string; y: number }[], id: string) =>
      arr.find((c) => c.id === id)!.y;

    const colBefore = useSceneStore
      .getState()
      .getNodes()
      .find((n) => n.id === "col")!;
    const before = useLayoutStore
      .getState()
      .calculateLayoutForFrame(colBefore as never);
    // Baseline flow: r1@0, r2@40, r3@80. Note: applyLayoutToChildren passes ALL
    // children through, so the returned array still lists all three.
    expect(before.map((c) => c.id).sort()).toEqual(["r1", "r2", "r3"]);
    expect(yOf(before, "r3")).toBe(80);

    useSceneStore.getState().toggleVisibility("r1");

    const colAfter = useSceneStore
      .getState()
      .getNodes()
      .find((n) => n.id === "col")!;
    const after = useLayoutStore
      .getState()
      .calculateLayoutForFrame(colAfter as never);
    // r1 hidden -> flow collapses: visible r2@0, r3@40. Proves the layout cache
    // invalidated (nodesById identity changed) and hidden child excluded from flow.
    expect(yOf(after, "r2")).toBe(0);
    expect(yOf(after, "r3")).toBe(40);
  });
});
