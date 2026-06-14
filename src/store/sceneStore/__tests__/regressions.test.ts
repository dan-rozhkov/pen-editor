import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useVariableStore } from "@/store/variableStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { collectDescendantIds, type FlatSceneNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

// Mirror the real undo cycle: snapshot current -> ask history -> restore.
function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

function redo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const next = useHistoryStore.getState().redo(snapshot);
  if (next) useSceneStore.getState().restoreSnapshot(next);
  return next;
}

function addConnector(id: string, startNodeId: string, endNodeId: string) {
  const connector = {
    id,
    type: "connector",
    name: "Connector",
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    startConnection: { nodeId: startNodeId, anchor: "right" },
    endConnection: { nodeId: endNodeId, anchor: "left" },
    points: [0, 0, 0, 0],
  } as unknown as FlatSceneNode;
  useSceneStore.setState((s) => ({
    nodesById: { ...s.nodesById, [id]: connector },
    parentById: { ...s.parentById, [id]: null },
    rootIds: [...s.rootIds, id],
    _cachedTree: null,
  }));
}

describe("history/scene regressions", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  // S1: selection-change snapshots used to omit componentArtifactsById, so
  // restoreSnapshot's `?? {}` fallback wiped all component sync-state on undo.
  describe("component artifacts survive undo of a selection change (S1)", () => {
    it("preserves the artifact map after undo", () => {
      const artifact = { revision: 1, syncState: "in_sync" as const };
      useSceneStore.setState({ componentArtifactsById: { frame1: artifact } });

      // A selection change records a history snapshot of the current scene.
      useSelectionStore.getState().setSelectedIds(["rect1"]);
      expect(useHistoryStore.getState().past.length).toBeGreaterThan(0);

      undo();

      expect(scene().componentArtifactsById["frame1"]).toEqual(artifact);
    });
  });

  // S2: moveNode had no cycle guard, so dropping a node into its own descendant
  // created a parent/child cycle and stack-overflowed tree traversal.
  describe("moveNode cycle guard (S2)", () => {
    it("rejects moving a node into itself", () => {
      scene().moveNode("frame1", "frame1", 0);

      expect(scene().parentById["frame1"]).toBe(null);
      expect(scene().rootIds).toContain("frame1");
    });

    it("rejects moving a node into one of its descendants", () => {
      // rect1 is a child of frame1 — moving frame1 under rect1 would be a cycle.
      scene().moveNode("frame1", "rect1", 0);

      expect(scene().parentById["frame1"]).toBe(null);
      expect(scene().childrenById["rect1"]).toBeUndefined();
      // Tree still builds without overflowing the stack.
      expect(() => scene().getNodes()).not.toThrow();
    });

    it("still performs a valid reparent", () => {
      scene().moveNode("rect2", "frame1", 0);

      expect(scene().parentById["rect2"]).toBe("frame1");
      expect(scene().childrenById["frame1"]).toContain("rect2");
      expect(scene().rootIds).not.toContain("rect2");
    });
  });

  // Defense-in-depth: recursive traversal must terminate even on a corrupt
  // graph that already contains a cycle.
  it("collectDescendantIds terminates on a cyclic graph", () => {
    const childrenById = { a: ["b"], b: ["a"] };
    expect(() => collectDescendantIds("a", childrenById)).not.toThrow();
  });

  // S3: deleting a node must also remove connectors anchored to it (and its
  // descendants), otherwise they dangle and leak into the saved document.
  describe("connector orphan cleanup on delete (S3)", () => {
    it("removes connectors anchored to the deleted node", () => {
      addConnector("conn1", "rect1", "rect2");

      scene().deleteNode("rect1");

      expect(scene().nodesById["conn1"]).toBeUndefined();
      expect(scene().rootIds).not.toContain("conn1");
    });

    it("removes connectors anchored to a descendant of a deleted container", () => {
      // conn1 points at rect1, which is a child of frame1.
      addConnector("conn1", "rect1", "rect2");

      scene().deleteNode("frame1");

      expect(scene().nodesById["conn1"]).toBeUndefined();
    });

    it("keeps connectors that don't reference the deleted node", () => {
      addConnector("conn1", "rect1", "rect2");

      scene().deleteNode("text1");

      expect(scene().nodesById["conn1"]).toBeDefined();
    });
  });

  // V3: variable edits go through history, so undo/redo round-trips them.
  describe("variable edits are undoable (V3)", () => {
    it("undo removes an added variable; redo restores it", () => {
      expect(useVariableStore.getState().variables).toHaveLength(0);

      useVariableStore.getState().addVariable({
        id: "v1",
        name: "--brand",
        type: "color",
        value: "#3366ff",
      });
      expect(useVariableStore.getState().variables).toHaveLength(1);

      undo();
      expect(useVariableStore.getState().variables).toHaveLength(0);

      redo();
      expect(
        useVariableStore.getState().variables.map((v) => v.id),
      ).toContain("v1");
    });

    it("undo reverts a variable value change", () => {
      useVariableStore.getState().addVariable({
        id: "v1",
        name: "--brand",
        type: "color",
        value: "#3366ff",
      });

      useVariableStore.getState().updateVariable("v1", { value: "#ff0000" });
      expect(useVariableStore.getState().variables[0].value).toBe("#ff0000");

      undo();
      expect(useVariableStore.getState().variables[0].value).toBe("#3366ff");
    });
  });
});
