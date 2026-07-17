import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { usePixiCanvasState } from "@/pixi/PixiCanvas";

// This hook holds exactly the subscription+memo block that used to live
// inline in <PixiCanvas>, keyed on the current selection/editing state from
// useSelectionStore. It exercises it the same way PixiCanvas would: reading
// editingNodeId/editingMode/instanceContext/selectedIds fresh on every call.
function useHarness() {
  const editingNodeId = useSelectionStore((s) => s.editingNodeId);
  const editingMode = useSelectionStore((s) => s.editingMode);
  const instanceContext = useSelectionStore((s) => s.instanceContext);
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  return usePixiCanvasState({ editingNodeId, editingMode, instanceContext, selectedIds });
}

describe("usePixiCanvasState (PixiCanvas node-scoped subscriptions)", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("does not re-render on unrelated node mutations", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useHarness();
    });

    expect(result.current.selectedFrameNode).toBeNull();
    const rendersAfterMount = renders;

    // Mutate a node that is neither selected nor being edited.
    act(() => {
      useSceneStore.getState().updateNode("rect2", { x: 5 });
    });

    expect(renders).toBe(rendersAfterMount);

    // Now select a frame node — this IS selection-relevant and must
    // trigger a re-render (and populate selectedFrameNode).
    act(() => {
      useSelectionStore.setState({ selectedIds: ["frame1"] });
    });

    expect(renders).toBe(rendersAfterMount + 1);
    expect(result.current.selectedFrameNode?.id).toBe("frame1");
  });

  it("re-renders when the node under edit is mutated, not others", () => {
    useSelectionStore.setState({
      editingNodeId: "text1",
      editingMode: "text",
      selectedIds: ["text1"],
    });

    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useHarness();
    });

    expect(result.current.editingNode?.id).toBe("text1");
    const rendersAfterMount = renders;

    // Unrelated node mutates — no re-render.
    act(() => {
      useSceneStore.getState().updateNode("rect1", { x: 42 });
    });
    expect(renders).toBe(rendersAfterMount);

    // The node being edited mutates — must re-render and reflect the change.
    act(() => {
      useSceneStore.getState().updateNode("text1", { text: "Hello world" });
    });
    expect(renders).toBe(rendersAfterMount + 1);
    expect((result.current.editingNode as { text?: string } | null)?.text).toBe(
      "Hello world",
    );
  });
});
