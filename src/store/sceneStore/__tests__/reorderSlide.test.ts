import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";
import { resolveSlideOrder } from "@/utils/slideOrder";

function scene() {
  return useSceneStore.getState();
}

function pastLen() {
  return useHistoryStore.getState().past.length;
}

// Mirrors the real undo cycle used elsewhere in the test suite.
function undo() {
  const snapshot = createSnapshot(useSceneStore.getState());
  const prev = useHistoryStore.getState().undo(snapshot);
  if (prev) useSceneStore.getState().restoreSnapshot(prev);
  return prev;
}

describe("sceneStore.reorderSlide", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    // seedScene ships one top-level frame ("frame1") + one non-frame root
    // ("rect2"). Add a second top-level frame so there's something to reorder.
    scene().addNode({
      id: "frame2",
      type: "frame",
      name: "Slide 2",
      x: 600,
      y: 0,
      width: 400,
      height: 300,
      fill: "#ffffff",
      children: [],
    } as never);
  });

  it("reorders the resolved slide order and records history", () => {
    const before = pastLen();
    const order = resolveSlideOrder(scene().nodesById, scene().rootIds, scene().slideOrder);
    expect(order).toEqual(["frame1", "frame2"]);

    scene().reorderSlide(0, 1);

    expect(scene().slideOrder).toEqual(["frame2", "frame1"]);
    expect(pastLen()).toBe(before + 1);
  });

  it("does not touch nodesById, rootIds, or node coordinates", () => {
    const nodesBefore = scene().nodesById;
    const rootIdsBefore = scene().rootIds;
    const frame1Before = { ...scene().nodesById["frame1"] };
    const frame2Before = { ...scene().nodesById["frame2"] };

    scene().reorderSlide(0, 1);

    expect(scene().nodesById).toBe(nodesBefore);
    expect(scene().rootIds).toBe(rootIdsBefore);
    expect(scene().nodesById["frame1"]).toEqual(frame1Before);
    expect(scene().nodesById["frame2"]).toEqual(frame2Before);
  });

  it("is a no-op for an out-of-range index (no history entry)", () => {
    const before = pastLen();
    const orderBefore = scene().slideOrder;
    scene().reorderSlide(0, 5);
    expect(scene().slideOrder).toBe(orderBefore);
    expect(pastLen()).toBe(before);
  });

  it("is a no-op when fromIndex === toIndex", () => {
    const before = pastLen();
    scene().reorderSlide(0, 0);
    expect(pastLen()).toBe(before);
  });

  it("round-trips through undo", () => {
    scene().reorderSlide(0, 1);
    expect(scene().slideOrder).toEqual(["frame2", "frame1"]);

    undo();

    expect(
      resolveSlideOrder(scene().nodesById, scene().rootIds, scene().slideOrder),
    ).toEqual(["frame1", "frame2"]);
  });
});
