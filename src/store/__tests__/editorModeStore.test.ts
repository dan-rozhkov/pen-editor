import { beforeEach, describe, expect, it } from "vitest";
import {
  useEditorModeStore,
  canEditScene,
  canInteractCanvas,
  presentFitNode,
} from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

function seedFrames() {
  // Two top-level frames + one non-frame root; B is above A on canvas, but
  // slideOrder (the panel/Present source of truth) puts A before B.
  const frameA = { id: "A", type: "frame", x: 0, y: 100, width: 50, height: 50, children: [] };
  const frameB = { id: "B", type: "frame", x: 10, y: 0, width: 50, height: 50, children: [] };
  const rect = { id: "R", type: "rect", x: 0, y: 0, width: 10, height: 10 };
  useSceneStore.setState({
    nodesById: { A: frameA, B: frameB, R: rect } as never,
    parentById: {},
    childrenById: { A: [], B: [], R: [] },
    rootIds: ["A", "B", "R"],
    slideOrder: ["A", "B"],
  });
}

describe("editorModeStore", () => {
  beforeEach(() => {
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSelectionStore.setState({ selectedIds: [] } as never);
    seedFrames();
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

  it("enterPresent orders frames by slideOrder (not spatial y/x) and starts at selected frame", () => {
    useSelectionStore.setState({ selectedIds: ["A"] } as never);
    useEditorModeStore.getState().enterPresent();
    const st = useEditorModeStore.getState();
    expect(st.mode).toBe("present");
    expect(st.presentFrameIds).toEqual(["A", "B"]);
    expect(st.presentIndex).toBe(0); // A is first in slideOrder
  });

  it("enterPresent falls back to rootIds order for frames not yet in slideOrder", () => {
    useSceneStore.setState({ slideOrder: [] });
    useEditorModeStore.getState().enterPresent();
    expect(useEditorModeStore.getState().presentFrameIds).toEqual(["A", "B"]);
  });

  it("enterPresent clears the selection but still starts at the selected frame", () => {
    useSelectionStore.getState().setSelectedIds(["B"]);
    useEditorModeStore.getState().enterPresent();
    expect(useEditorModeStore.getState().presentIndex).toBe(1); // B is second in slideOrder
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
  });

  it("enterPresent is a no-op when there are no frames", () => {
    useSceneStore.setState({ nodesById: {} as never, parentById: {}, childrenById: {}, rootIds: [], slideOrder: [] });
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
