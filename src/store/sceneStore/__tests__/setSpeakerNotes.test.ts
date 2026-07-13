import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import type { FlatFrameNode } from "@/types/scene";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

function frame1Notes(): string | undefined {
  return (scene().nodesById.frame1 as FlatFrameNode | undefined)?.speakerNotes;
}

function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

describe("sceneStore.setSpeakerNotes", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("writes speakerNotes onto the frame node and records history", () => {
    const before = pastLen();
    scene().setSpeakerNotes("frame1", "Remember to smile");
    expect(frame1Notes()).toBe("Remember to smile");
    expect(pastLen()).toBe(before + 1);
  });

  it("normalizes an empty string to undefined", () => {
    scene().setSpeakerNotes("frame1", "hello");
    scene().setSpeakerNotes("frame1", "");
    expect(frame1Notes()).toBeUndefined();
  });

  it("normalizes a whitespace-only string to undefined", () => {
    scene().setSpeakerNotes("frame1", "   ");
    expect(frame1Notes()).toBeUndefined();
  });

  it("is a no-op for a non-existent node id", () => {
    const before = pastLen();
    scene().setSpeakerNotes("does-not-exist", "notes");
    expect(pastLen()).toBe(before);
  });

  it("round-trips through undo", () => {
    scene().setSpeakerNotes("frame1", "notes v1");
    undo();
    expect(frame1Notes()).toBeUndefined();
  });

  it("is removed when the frame is deleted", () => {
    scene().setSpeakerNotes("frame1", "notes");
    expect(frame1Notes()).toBe("notes");
    scene().deleteNode("frame1");
    expect(scene().nodesById.frame1).toBeUndefined();
  });

  describe("setSpeakerNotesWithoutHistory", () => {
    it("writes speakerNotes without recording history", () => {
      const before = pastLen();
      scene().setSpeakerNotesWithoutHistory("frame1", "draft text");
      expect(frame1Notes()).toBe("draft text");
      expect(pastLen()).toBe(before);
    });

    it("normalizes an empty string to undefined", () => {
      scene().setSpeakerNotesWithoutHistory("frame1", "hello");
      scene().setSpeakerNotesWithoutHistory("frame1", "");
      expect(frame1Notes()).toBeUndefined();
    });
  });
});
