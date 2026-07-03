import { beforeEach, describe, expect, it } from "vitest";
import {
  useEditorModeStore,
  orderedFrameIds,
  canEditScene,
  canInteractCanvas,
  presentFitNode,
} from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

function seedFrames() {
  // Two top-level frames + one non-frame root; B is above A on canvas.
  const frameA = { id: "A", type: "frame", x: 0, y: 100, width: 50, height: 50, children: [] };
  const frameB = { id: "B", type: "frame", x: 10, y: 0, width: 50, height: 50, children: [] };
  const rect = { id: "R", type: "rect", x: 0, y: 0, width: 10, height: 10 };
  useSceneStore.setState({
    nodesById: { A: frameA, B: frameB, R: rect } as never,
    parentById: {},
    childrenById: { A: [], B: [], R: [] },
    rootIds: ["A", "B", "R"],
  });
}

describe("editorModeStore", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSelectionStore.setState({ selectedIds: [] } as never);
    seedFrames();
  });

  it("orders top-level frames by (y, x) and ignores non-frames", () => {
    const s = useSceneStore.getState();
    expect(orderedFrameIds(s.nodesById, s.rootIds)).toEqual(["B", "A"]);
  });

  it("predicates express the gating policy", () => {
    expect(canEditScene("edit")).toBe(true);
    expect(canEditScene("view")).toBe(false);
    expect(canEditScene("present")).toBe(false);
    expect(canInteractCanvas("edit")).toBe(true);
    expect(canInteractCanvas("view")).toBe(true);
    expect(canInteractCanvas("present")).toBe(false);
  });

  it("enterView / exitToEdit toggle mode", () => {
    useEditorModeStore.getState().enterView();
    expect(useEditorModeStore.getState().mode).toBe("view");
    useEditorModeStore.getState().exitToEdit();
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  it("enterView clears the current selection", () => {
    useSelectionStore.getState().setSelectedIds(["A"]);
    useEditorModeStore.getState().enterView();
    expect(useEditorModeStore.getState().mode).toBe("view");
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
  });

  it("enterPresent captures ordered frames and starts at selected frame", () => {
    useSelectionStore.setState({ selectedIds: ["A"] } as never);
    useEditorModeStore.getState().enterPresent();
    const st = useEditorModeStore.getState();
    expect(st.mode).toBe("present");
    expect(st.presentFrameIds).toEqual(["B", "A"]);
    expect(st.presentIndex).toBe(1); // A is second
  });

  it("enterPresent is a no-op when there are no frames", () => {
    useSceneStore.setState({ nodesById: {} as never, parentById: {}, childrenById: {}, rootIds: [] });
    useEditorModeStore.getState().enterPresent();
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  it("next/prevFrame clamp at the ends", () => {
    useEditorModeStore.getState().enterPresent(); // index 0, two frames
    const a = useEditorModeStore.getState();
    a.prevFrame();
    expect(useEditorModeStore.getState().presentIndex).toBe(0);
    a.nextFrame();
    expect(useEditorModeStore.getState().presentIndex).toBe(1);
    a.nextFrame();
    expect(useEditorModeStore.getState().presentIndex).toBe(1);
  });

  it("presentFitNode returns the matching node wrapped in an array", () => {
    const nodes = useSceneStore.getState().getNodes();
    expect(presentFitNode(nodes, "A").map((n) => n.id)).toEqual(["A"]);
    expect(presentFitNode(nodes, "missing")).toEqual([]);
    expect(presentFitNode(nodes, undefined)).toEqual([]);
  });
});
