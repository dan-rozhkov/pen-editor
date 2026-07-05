import { describe, it, expect, beforeEach } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import { applyAnchorEditToNode, moveAnchorPoint } from "@/utils/pathAnchors";
import type { PathNode, SceneNode } from "@/types/scene";
import { enterPathEditMode } from "../pathEditMode";

function makePencilPath(id: string): SceneNode {
  return {
    id,
    type: "path",
    name: "Pencil",
    x: 0,
    y: 0,
    width: 10,
    height: 5,
    geometry: "M0,0 L10,0 L10,5 L0,5 Z",
    geometryBounds: { x: 0, y: 0, width: 10, height: 5 },
  } as SceneNode;
}

describe("enterPathEditMode", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("lazily derives structured points from a legacy path's geometry and enters edit mode", () => {
    const path = makePencilPath("legacyPath");
    useSceneStore.getState().addNode(path);

    const ok = enterPathEditMode("legacyPath");
    expect(ok).toBe(true);

    const node = useSceneStore.getState().nodesById["legacyPath"] as unknown as PathNode;
    expect(node.points).toBeDefined();
    expect(node.points).toHaveLength(4);
    expect(node.closed).toBe(true);

    const selection = useSelectionStore.getState();
    expect(selection.editingNodeId).toBe("legacyPath");
    expect(selection.editingMode).toBe("path");
    expect(selection.selectedIds).toEqual(["legacyPath"]);
  });

  it("does not add a history entry for the passive points migration itself (only the selection change does)", () => {
    const path = makePencilPath("legacyPath2");
    useSceneStore.getState().addNode(path);
    const pastLengthBefore = useHistoryStore.getState().past.length;

    enterPathEditMode("legacyPath2");

    // `select()` records one entry for the selection change; the points
    // migration (updateNodeWithoutHistory) must not add a second one.
    expect(useHistoryStore.getState().past.length).toBe(pastLengthBefore + 1);
  });

  it("returns false and does not enter edit mode for a non-path node", () => {
    const ok = enterPathEditMode("rect1");
    expect(ok).toBe(false);
    expect(useSelectionStore.getState().editingMode).toBeNull();
  });

  it("returns false for geometry outside the structural-edit subset (e.g. arcs)", () => {
    const arcPath: SceneNode = {
      id: "arcPath",
      type: "path",
      name: "Arc",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      geometry: "M0,0 A5,5 0 0 1 10,10",
    } as SceneNode;
    useSceneStore.getState().addNode(arcPath);

    const ok = enterPathEditMode("arcPath");
    expect(ok).toBe(false);
    expect(useSelectionStore.getState().editingMode).toBeNull();
  });

  it("reuses an already-migrated points array without re-deriving it", () => {
    const path = makePencilPath("legacyPath3");
    useSceneStore.getState().addNode(path);
    enterPathEditMode("legacyPath3");
    const pointsAfterFirstEntry = (useSceneStore.getState().nodesById["legacyPath3"] as unknown as PathNode).points;

    useSelectionStore.getState().stopEditing();
    enterPathEditMode("legacyPath3");
    const pointsAfterSecondEntry = (useSceneStore.getState().nodesById["legacyPath3"] as unknown as PathNode).points;

    expect(pointsAfterSecondEntry).toBe(pointsAfterFirstEntry);
  });
});

describe("path point edits integrate with undo/redo", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("restores the pre-edit geometry/points after undo, and re-applies it after redo", () => {
    const path = makePencilPath("editablePath");
    useSceneStore.getState().addNode(path);
    enterPathEditMode("editablePath");

    const before = useSceneStore.getState().nodesById["editablePath"] as unknown as PathNode;
    const originalGeometry = before.geometry;
    const originalPoints = before.points!;

    // Mirrors what pathEditController does on the first pointer-move of a
    // drag: snapshot history once, then commit the mutated node via
    // updateNodeWithoutHistory (the drag itself doesn't need per-frame
    // history entries — only one checkpoint for the whole gesture).
    saveHistory(useSceneStore.getState());
    const movedPoints = moveAnchorPoint(originalPoints, 0, 3, 4);
    const updates = applyAnchorEditToNode(before, movedPoints, before.closed ?? false);
    useSceneStore.getState().updateNodeWithoutHistory("editablePath", updates);

    const afterMove = useSceneStore.getState().nodesById["editablePath"] as unknown as PathNode;
    expect(afterMove.geometry).not.toBe(originalGeometry);
    expect(afterMove.points![0]).toEqual({ x: 3, y: 4 });

    // Undo
    const snapshotAfterMove = createSnapshot(useSceneStore.getState());
    const prevSnapshot = useHistoryStore.getState().undo(snapshotAfterMove);
    expect(prevSnapshot).not.toBeNull();
    useSceneStore.getState().restoreSnapshot(prevSnapshot!);

    const afterUndo = useSceneStore.getState().nodesById["editablePath"] as unknown as PathNode;
    expect(afterUndo.geometry).toBe(originalGeometry);
    expect(afterUndo.points).toEqual(originalPoints);

    // Redo
    const snapshotAfterUndo = createSnapshot(useSceneStore.getState());
    const nextSnapshot = useHistoryStore.getState().redo(snapshotAfterUndo);
    expect(nextSnapshot).not.toBeNull();
    useSceneStore.getState().restoreSnapshot(nextSnapshot!);

    const afterRedo = useSceneStore.getState().nodesById["editablePath"] as unknown as PathNode;
    expect(afterRedo.geometry).toBe(afterMove.geometry);
    expect(afterRedo.points![0]).toEqual({ x: 3, y: 4 });
  });
});
