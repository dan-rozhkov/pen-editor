import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { useGuidesStore } from "@/store/guidesStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatSceneNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

function futureLen() {
  return useHistoryStore.getState().future.length;
}

// Replicate the real undo/redo cycle from useCanvasKeyboardShortcuts:
// snapshot current -> ask history for the target -> restore it if present.
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

describe("sceneStore mutations", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  describe("deleteNode", () => {
    it("removes a leaf node from its parent's children", () => {
      const before = pastLen();
      scene().deleteNode("rect1");

      const s = scene();
      expect(s.nodesById["rect1"]).toBeUndefined();
      expect(s.parentById["rect1"]).toBeUndefined();
      expect(s.childrenById["frame1"]).toEqual(["text1"]);
      expect(s.rootIds).toEqual(["frame1", "rect2"]);
      expect(pastLen()).toBe(before + 1);
    });

    it("cascades to descendants when deleting a container", () => {
      scene().deleteNode("frame1");

      const s = scene();
      expect(s.nodesById["frame1"]).toBeUndefined();
      expect(s.nodesById["rect1"]).toBeUndefined();
      expect(s.nodesById["text1"]).toBeUndefined();
      expect(s.childrenById["frame1"]).toBeUndefined();
      expect(s.parentById["rect1"]).toBeUndefined();
      expect(s.rootIds).toEqual(["rect2"]);
    });

    it("removes a root node from rootIds", () => {
      scene().deleteNode("rect2");
      expect(scene().rootIds).toEqual(["frame1"]);
      expect(scene().nodesById["rect2"]).toBeUndefined();
    });

    it("removes connectors that reference the deleted node", () => {
      const connector = {
        id: "conn1",
        type: "connector",
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        startConnection: { nodeId: "rect1", anchor: "right" },
        endConnection: { nodeId: "rect2", anchor: "left" },
        points: [0, 0, 0, 0],
      } as unknown as FlatSceneNode;
      const s = scene();
      useSceneStore.setState({
        nodesById: { ...s.nodesById, conn1: connector },
        parentById: { ...s.parentById, conn1: null },
        rootIds: [...s.rootIds, "conn1"],
        _cachedTree: null,
      });

      scene().deleteNode("rect1");

      const after = scene();
      expect(after.nodesById["conn1"]).toBeUndefined();
      expect(after.rootIds).not.toContain("conn1");
    });

    it("is a no-op without history for a missing id", () => {
      const before = pastLen();
      scene().deleteNode("ghost");
      expect(pastLen()).toBe(before);
      expect(Object.keys(scene().nodesById).sort()).toEqual([
        "frame1",
        "rect1",
        "rect2",
        "text1",
      ]);
    });
  });

  describe("reorderNode", () => {
    it("reorders root nodes and records history", () => {
      const before = pastLen();
      scene().reorderNode(0, 1);
      expect(scene().rootIds).toEqual(["rect2", "frame1"]);
      expect(pastLen()).toBe(before + 1);
    });
  });

  describe("moveNode", () => {
    it("moves a child out to the root at the given index", () => {
      scene().moveNode("rect1", null, 0);

      const s = scene();
      expect(s.parentById["rect1"]).toBeNull();
      expect(s.childrenById["frame1"]).toEqual(["text1"]);
      expect(s.rootIds).toEqual(["rect1", "frame1", "rect2"]);
    });

    it("moves a root node into a frame at the given index", () => {
      const before = pastLen();
      scene().moveNode("rect2", "frame1", 1);

      const s = scene();
      expect(s.parentById["rect2"]).toBe("frame1");
      expect(s.childrenById["frame1"]).toEqual(["rect1", "rect2", "text1"]);
      expect(s.rootIds).toEqual(["frame1"]);
      expect(pastLen()).toBe(before + 1);
    });

    it("is a no-op for a missing node", () => {
      const before = pastLen();
      scene().moveNode("ghost", "frame1", 0);
      expect(pastLen()).toBe(before);
      expect(scene().childrenById["frame1"]).toEqual(["rect1", "text1"]);
    });
  });

  describe("undo / redo", () => {
    it("undoes a single delete and redoes it", () => {
      scene().deleteNode("rect1");
      expect(scene().nodesById["rect1"]).toBeUndefined();

      undo();
      const restored = scene();
      expect(restored.nodesById["rect1"]).toBeDefined();
      expect(restored.childrenById["frame1"]).toEqual(["rect1", "text1"]);

      redo();
      expect(scene().nodesById["rect1"]).toBeUndefined();
      expect(scene().childrenById["frame1"]).toEqual(["text1"]);
    });

    it("walks multiple steps back and forward in order", () => {
      scene().deleteNode("rect1");
      scene().deleteNode("text1");
      expect(scene().childrenById["frame1"]).toEqual([]);

      undo(); // text1 back
      expect(scene().childrenById["frame1"]).toEqual(["text1"]);
      undo(); // rect1 back
      expect(scene().childrenById["frame1"]).toEqual(["rect1", "text1"]);

      redo(); // rect1 gone
      expect(scene().childrenById["frame1"]).toEqual(["text1"]);
      redo(); // text1 gone
      expect(scene().childrenById["frame1"]).toEqual([]);
    });

    it("restores positions after an undo of moveNode", () => {
      scene().moveNode("rect1", null, 0);
      expect(scene().parentById["rect1"]).toBeNull();

      undo();
      const s = scene();
      expect(s.parentById["rect1"]).toBe("frame1");
      expect(s.childrenById["frame1"]).toEqual(["rect1", "text1"]);
      expect(s.rootIds).toEqual(["frame1", "rect2"]);
    });

    it("returns null and changes nothing when there is nothing to undo", () => {
      expect(undo()).toBeNull();
      expect(Object.keys(scene().nodesById).sort()).toEqual([
        "frame1",
        "rect1",
        "rect2",
        "text1",
      ]);
    });

    it("clears the redo stack once a new action is performed", () => {
      scene().deleteNode("rect1");
      undo(); // rect1 back, future has 1 entry
      expect(futureLen()).toBe(1);

      scene().deleteNode("text1"); // new action clears redo
      expect(futureLen()).toBe(0);
      expect(redo()).toBeNull();
      expect(scene().nodesById["text1"]).toBeUndefined();
    });
  });

  describe("persistent guides in undo/redo", () => {
    // Mirrors how Rulers.tsx saves history: snapshot the pre-mutation state,
    // then mutate useGuidesStore directly (guides live outside sceneStore).
    it("round-trips a guide create through undo/redo", () => {
      useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
      useGuidesStore.getState().addGuide("vertical", 120);
      expect(useGuidesStore.getState().guides).toHaveLength(1);

      undo();
      expect(useGuidesStore.getState().guides).toHaveLength(0);

      redo();
      expect(useGuidesStore.getState().guides).toHaveLength(1);
      expect(useGuidesStore.getState().guides[0]).toMatchObject({
        orientation: "vertical",
        position: 120,
      });
    });

    it("round-trips a guide move through undo/redo", () => {
      const id = useGuidesStore.getState().addGuide("horizontal", 50);

      useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
      useGuidesStore.getState().updateGuidePosition(id, 200);
      expect(useGuidesStore.getState().guides[0].position).toBe(200);

      undo();
      expect(useGuidesStore.getState().guides[0].position).toBe(50);

      redo();
      expect(useGuidesStore.getState().guides[0].position).toBe(200);
    });

    it("round-trips a guide delete through undo/redo", () => {
      const id = useGuidesStore.getState().addGuide("vertical", 75);

      useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
      useGuidesStore.getState().removeGuide(id);
      expect(useGuidesStore.getState().guides).toHaveLength(0);

      undo();
      expect(useGuidesStore.getState().guides).toHaveLength(1);
      expect(useGuidesStore.getState().guides[0].id).toBe(id);
    });
  });
});
