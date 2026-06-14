import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { collectDescendantIds } from "@/types/scene";

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
});
