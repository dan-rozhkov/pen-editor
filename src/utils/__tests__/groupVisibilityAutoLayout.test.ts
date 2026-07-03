import { describe, it, expect, beforeEach } from "vitest";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import type { FrameNode, SceneNode, FlatSceneNode } from "@/types/scene";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { resetStores } from "@/test/fixtures";

type Sizing = { widthMode?: string; heightMode?: string };

function rect(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Partial<SceneNode> & { sizing?: Sizing } = {},
): SceneNode {
  return {
    id,
    type: "rect",
    x,
    y,
    width,
    height,
    ...extra,
  } as unknown as SceneNode;
}

function group(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: SceneNode[],
): SceneNode {
  return {
    id,
    type: "group",
    x,
    y,
    width,
    height,
    children,
  } as unknown as SceneNode;
}

function frame(
  layout: Record<string, unknown>,
  size: { width: number; height: number },
  children: SceneNode[],
  extra: Record<string, unknown> = {},
): FrameNode {
  return {
    id: "f",
    type: "frame",
    x: 0,
    y: 0,
    width: size.width,
    height: size.height,
    layout: { autoLayout: true, ...layout },
    children,
    ...extra,
  } as unknown as FrameNode;
}

/**
 * Column auto-layout frame (fit both, gap 10, padding 10) containing
 *   group[r1(120x40@y0), r2(120x40@y50)]  (group bbox 120x90)
 * + r3(120x40). Baseline effective frame size = 140 x 160.
 */
function reproFrame(
  opts: { r1Hidden?: boolean; r1Disabled?: boolean } = {},
): FrameNode {
  const r1extra: Partial<SceneNode> = {};
  if (opts.r1Hidden) r1extra.visible = false;
  if (opts.r1Disabled) (r1extra as { enabled?: boolean }).enabled = false;

  return frame(
    {
      flexDirection: "column",
      gap: 10,
      paddingTop: 10,
      paddingRight: 10,
      paddingBottom: 10,
      paddingLeft: 10,
    },
    { width: 999, height: 999 },
    [
      group("g", 0, 0, 120, 90, [
        rect("r1", 0, 0, 120, 40, r1extra),
        rect("r2", 0, 50, 120, 40),
      ]),
      rect("r3", 0, 0, 120, 40),
    ],
    { sizing: { widthMode: "fit_content", heightMode: "fit_content" } },
  );
}

describe("group visibility affects auto-layout intrinsic size (unit)", () => {
  it("baseline: frame fits group bbox + sibling", () => {
    const size = calculateFrameIntrinsicSize(reproFrame(), {
      fitWidth: true,
      fitHeight: true,
    });
    expect(size).toEqual({ width: 140, height: 160 });
  });

  it("hiding a group child (visible:false) shrinks the group's contribution", () => {
    const size = calculateFrameIntrinsicSize(reproFrame({ r1Hidden: true }), {
      fitWidth: true,
      fitHeight: true,
    });
    // group shrinks to just r2 (tight bbox: y50..y90 => 40 tall)
    // main = 40 (group) + 10 gap + 40 (r3) + 20 pad = 110
    expect(size.height).toBe(110);
    expect(size.width).toBe(140);
  });

  it("disabling a group child (enabled:false) behaves the same", () => {
    const size = calculateFrameIntrinsicSize(reproFrame({ r1Disabled: true }), {
      fitWidth: true,
      fitHeight: true,
    });
    expect(size.height).toBe(110);
  });

  it("nested group inside group also shrinks when a grandchild is hidden", () => {
    // outer group contains inner group[a(120x40@y0), b(120x40@y50)] => 120x90
    const f = frame(
      {
        flexDirection: "column",
        gap: 0,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      },
      { width: 999, height: 999 },
      [
        group("outerG", 0, 0, 120, 90, [
          group("innerG", 0, 0, 120, 90, [
            rect("a", 0, 0, 120, 40, { visible: false }),
            rect("b", 0, 50, 120, 40),
          ]),
        ]),
      ],
      { sizing: { widthMode: "fit_content", heightMode: "fit_content" } },
    );
    const size = calculateFrameIntrinsicSize(f, {
      fitWidth: true,
      fitHeight: true,
    });
    // inner shrinks to b's tight bbox (40), outer follows, frame = 40
    expect(size.height).toBe(40);
  });

  it("all group children hidden => group contributes zero size", () => {
    const f = frame(
      {
        flexDirection: "column",
        gap: 10,
        paddingTop: 0,
        paddingBottom: 0,
        paddingLeft: 0,
        paddingRight: 0,
      },
      { width: 999, height: 999 },
      [
        group("g", 0, 0, 120, 90, [
          rect("r1", 0, 0, 120, 40, { visible: false }),
          rect("r2", 0, 50, 120, 40, { visible: false }),
        ]),
        rect("r3", 0, 0, 120, 40),
      ],
      { sizing: { widthMode: "fit_content", heightMode: "fit_content" } },
    );
    const size = calculateFrameIntrinsicSize(f, {
      fitWidth: true,
      fitHeight: true,
    });
    // group contributes 0 height, but still occupies a flow slot => one gap remains
    // main = 0 (group) + 10 gap + 40 (r3) = 50
    expect(size.height).toBe(50);
    expect(size.width).toBe(120);
  });

  it("unhiding restores the original size", () => {
    const hidden = calculateFrameIntrinsicSize(reproFrame({ r1Hidden: true }), {
      fitWidth: true,
      fitHeight: true,
    });
    expect(hidden.height).toBe(110);
    const restored = calculateFrameIntrinsicSize(reproFrame(), {
      fitWidth: true,
      fitHeight: true,
    });
    expect(restored.height).toBe(160);
  });
});

// ── Store-level probe (seed via sceneStore + groupNodes + toggleVisibility) ──

function effectiveHeightOf(id: string): number {
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const nodes = useSceneStore.getState().getNodes();
  const size = getNodeEffectiveSize(nodes, id, calc);
  return size!.height;
}

function seedFrameWithGroup(): void {
  const col = {
    id: "col",
    type: "frame",
    name: "Col",
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 10,
      paddingTop: 10,
      paddingRight: 10,
      paddingBottom: 10,
      paddingLeft: 10,
    },
    sizing: { widthMode: "fit_content", heightMode: "fit_content" },
  } as unknown as FlatSceneNode;

  const mk = (id: string, x: number, y: number) =>
    ({
      id,
      type: "rect",
      x,
      y,
      width: 120,
      height: 40,
      sizing: { widthMode: "fixed", heightMode: "fixed" },
    }) as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: {
      col,
      r1: mk("r1", 0, 0),
      r2: mk("r2", 0, 50),
      r3: mk("r3", 0, 100),
    },
    parentById: { col: null, r1: "col", r2: "col", r3: "col" },
    childrenById: { col: ["r1", "r2", "r3"] },
    rootIds: ["col"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("group visibility affects auto-layout parent (store level)", () => {
  beforeEach(() => {
    resetStores();
  });

  it("hiding a node inside a group shrinks the fit-content frame", () => {
    seedFrameWithGroup();
    // Group r1 + r2 (bbox y0..y90 => 90 tall). Frame baseline:
    // 90 (group) + 10 gap + 40 (r3) + 20 pad = 160
    const gid = useSceneStore.getState().groupNodes(["r1", "r2"]);
    expect(gid).toBeTruthy();
    expect(effectiveHeightOf("col")).toBe(160);

    // Hide r1 (nested inside the group) -> group shrinks to 40, frame to 110
    useSceneStore.getState().toggleVisibility("r1");
    expect(effectiveHeightOf("col")).toBe(110);

    // Unhide -> restored
    useSceneStore.getState().toggleVisibility("r1");
    expect(effectiveHeightOf("col")).toBe(160);
  });
});
