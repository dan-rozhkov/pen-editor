import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores } from "@/test/fixtures";
import type { FlatSceneNode, SceneNode } from "@/types/scene";

// Regression test for perf-02: SelectionColorsSection must not recompute its
// aggregated color list when an UNRELATED node mutates. Before the fix it
// subscribed to the whole `nodesById`/`childrenById` maps, which get a new
// reference on every scene mutation (basicMutations.ts always spreads a new
// object) -- so any mutation anywhere in the document (e.g. every frame of a
// drag on a different node) re-ran `collectSelectionColors` over the whole
// selection subtree.
vi.mock("@/utils/selectionColors", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/selectionColors")>();
  return {
    ...actual,
    collectSelectionColors: vi.fn(actual.collectSelectionColors),
  };
});

vi.mock("@/components/ui/ColorPicker", () => ({
  CustomColorPicker: () => null,
}));

function seedSelectedNodeAndUnrelatedNode(): void {
  const selected = {
    id: "selectedNode",
    type: "rect",
    name: "Selected",
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;

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
    nodesById: { selectedNode: selected, unrelatedNode: unrelated },
    parentById: { selectedNode: null, unrelatedNode: null },
    childrenById: {},
    rootIds: ["selectedNode", "unrelatedNode"],
    componentArtifactsById: {},
    _cachedTree: null,
  });
}

describe("<SelectionColorsSection /> recompute on unrelated mutations (perf-02)", () => {
  beforeEach(() => {
    resetStores();
    vi.clearAllMocks();
  });

  afterEach(() => cleanup());

  it("does not recompute selection colors when an unrelated node mutates", async () => {
    const { collectSelectionColors } = await import("@/utils/selectionColors");

    seedSelectedNodeAndUnrelatedNode();
    const node = useSceneStore.getState().nodesById.selectedNode as unknown as SceneNode;

    const { SelectionColorsSection } = await import("../SelectionColorsSection");
    render(<SelectionColorsSection nodes={[node]} />);

    // Initial mount legitimately computes the color list once.
    vi.clearAllMocks();

    for (let i = 0; i < 5; i++) {
      act(() => {
        useSceneStore.getState().updateNode("unrelatedNode", { x: i * 10 });
      });
    }

    expect(collectSelectionColors).not.toHaveBeenCalled();
  });

  it("sanity: still recomputes when the selected node itself changes", async () => {
    const { collectSelectionColors } = await import("@/utils/selectionColors");

    seedSelectedNodeAndUnrelatedNode();
    const node = useSceneStore.getState().nodesById.selectedNode as unknown as SceneNode;

    const { SelectionColorsSection } = await import("../SelectionColorsSection");
    render(<SelectionColorsSection nodes={[node]} />);
    vi.clearAllMocks();

    act(() => {
      useSceneStore.getState().updateNode("selectedNode", { fill: "#00ff00" });
    });

    expect(collectSelectionColors).toHaveBeenCalled();
  });
});
