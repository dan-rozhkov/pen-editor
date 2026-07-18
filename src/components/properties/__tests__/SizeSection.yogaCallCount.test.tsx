import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode, SceneNode } from "@/types/scene";
import type { ParentContext } from "@/utils/nodeUtils";

// Regression test for perf-02: SizeSection must not call Yoga
// (calculateFrameIntrinsicSize / calculateFrameLayout) when an UNRELATED node
// mutates. Before the fix, SizeSection subscribed to the whole `nodesById`/
// `childrenById` maps, which get a brand-new reference on every scene
// mutation (basicMutations.ts always spreads into a new object) -- so ANY
// mutation (e.g. every frame of a drag on a different node) re-rendered
// SizeSection and re-ran its effectiveWidth/effectiveHeight useMemo, which
// invokes Yoga for a fit_content auto-layout frame.
vi.mock("@/utils/yogaLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/yogaLayout")>();
  return {
    ...actual,
    calculateFrameIntrinsicSize: vi.fn(actual.calculateFrameIntrinsicSize),
    calculateFrameLayout: vi.fn(actual.calculateFrameLayout),
  };
});

const ROOT_CONTEXT = { isInsideAutoLayout: false, parent: null } as unknown as ParentContext;

function seedFitContentFrameAndUnrelatedNode(): void {
  const autoFitFrame = {
    id: "autoFitFrame",
    type: "frame",
    name: "AutoFit",
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    fill: "#ffffff",
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 0,
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    },
    sizing: { widthMode: "fit_content", heightMode: "fit_content" },
  } as unknown as FlatSceneNode;

  const child = {
    id: "autoFitChild",
    type: "rect",
    name: "Child",
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

  // An unrelated root-level node -- simulates the node being dragged elsewhere
  // on the canvas while `autoFitFrame` is the current selection.
  const unrelated = {
    id: "unrelatedNode",
    type: "rect",
    name: "Unrelated",
    x: 0,
    y: 0,
    width: 20,
    height: 20,
    fill: "#0000ff",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { autoFitFrame, autoFitChild: child, unrelatedNode: unrelated },
    parentById: { autoFitFrame: null, autoFitChild: "autoFitFrame", unrelatedNode: null },
    childrenById: { autoFitFrame: ["autoFitChild"] },
    rootIds: ["autoFitFrame", "unrelatedNode"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("<SizeSection /> Yoga call count on unrelated mutations (perf-02)", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it("does not call calculateFrameIntrinsicSize/calculateFrameLayout when dragging an unrelated node", async () => {
    const { calculateFrameIntrinsicSize, calculateFrameLayout } = await import(
      "@/utils/yogaLayout"
    );

    seedFitContentFrameAndUnrelatedNode();
    const node = useSceneStore.getState().nodesById.autoFitFrame as unknown as SceneNode;

    const { SizeSection } = await import("../SizeSection");
    render(<SizeSection node={node} onUpdate={vi.fn()} parentContext={ROOT_CONTEXT} />);

    // Initial mount legitimately computes the intrinsic size once -- reset so
    // we only observe calls caused by the subsequent unrelated mutation.
    vi.clearAllMocks();

    // Simulate 5 "drag frames" of an unrelated node -- the exact scenario
    // called out in the task: every frame of a drag on ANY node used to
    // re-trigger Yoga for the selected node's SizeSection.
    for (let i = 0; i < 5; i++) {
      act(() => {
        useSceneStore.getState().updateNode("unrelatedNode", { x: i * 10 });
      });
    }

    expect(calculateFrameIntrinsicSize).not.toHaveBeenCalled();
    expect(calculateFrameLayout).not.toHaveBeenCalled();
  });

  it("sanity: still recomputes when the selected fit_content frame's own subtree changes", async () => {
    const { calculateFrameIntrinsicSize } = await import("@/utils/yogaLayout");

    seedFitContentFrameAndUnrelatedNode();
    const node = useSceneStore.getState().nodesById.autoFitFrame as unknown as SceneNode;

    const { SizeSection } = await import("../SizeSection");
    render(<SizeSection node={node} onUpdate={vi.fn()} parentContext={ROOT_CONTEXT} />);
    vi.clearAllMocks();

    act(() => {
      useSceneStore.getState().updateNode("autoFitChild", { width: 200 });
    });

    expect(calculateFrameIntrinsicSize).toHaveBeenCalled();
  });
});
