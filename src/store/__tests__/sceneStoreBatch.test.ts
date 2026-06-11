import { describe, it, expect, beforeEach } from "vitest";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

/**
 * Tests for `updateNodesWithoutHistory` — the batched store write used by the
 * connector sync pass. The key guarantees are: one notification per batch,
 * tree-cache invalidation, and no-op safety for empty / all-unknown batches.
 */
describe("sceneStore.updateNodesWithoutHistory", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("applies updates to multiple nodes in a single notification", () => {
    let notifications = 0;
    const unsub = useSceneStore.subscribe(() => {
      notifications += 1;
    });

    useSceneStore.getState().updateNodesWithoutHistory({
      rect1: { x: 11, width: 111 },
      rect2: { y: 22, height: 222 },
    });

    unsub();

    // Exactly one store write ⇒ one subscriber notification.
    expect(notifications).toBe(1);

    const state = useSceneStore.getState();
    expect(state.nodesById.rect1.x).toBe(11);
    expect(state.nodesById.rect1.width).toBe(111);
    expect(state.nodesById.rect2.y).toBe(22);
    expect(state.nodesById.rect2.height).toBe(222);
  });

  it("ignores unknown ids without throwing and still applies known ones", () => {
    expect(() =>
      useSceneStore.getState().updateNodesWithoutHistory({
        rect1: { x: 99 },
        doesNotExist: { x: 5 },
      }),
    ).not.toThrow();

    const state = useSceneStore.getState();
    expect(state.nodesById.rect1.x).toBe(99);
    expect(state.nodesById.doesNotExist).toBeUndefined();
  });

  it("does not notify for an all-unknown batch (returns same state)", () => {
    const before = useSceneStore.getState().nodesById;
    let notifications = 0;
    const unsub = useSceneStore.subscribe(() => {
      notifications += 1;
    });

    useSceneStore.getState().updateNodesWithoutHistory({
      ghostA: { x: 1 },
      ghostB: { x: 2 },
    });

    unsub();
    expect(notifications).toBe(0);
    // Reference-equal nodesById ⇒ no new state object was produced.
    expect(useSceneStore.getState().nodesById).toBe(before);
  });

  it("does not notify for an empty batch", () => {
    let notifications = 0;
    const unsub = useSceneStore.subscribe(() => {
      notifications += 1;
    });

    useSceneStore.getState().updateNodesWithoutHistory({});

    unsub();
    expect(notifications).toBe(0);
  });

  it("invalidates the tree cache: getNodes() returns a fresh tree reflecting the new values", () => {
    const treeBefore = useSceneStore.getState().getNodes();

    useSceneStore.getState().updateNodesWithoutHistory({
      rect2: { x: 777 },
    });

    const treeAfter = useSceneStore.getState().getNodes();
    // _cachedTree was set to null ⇒ rebuilt into a new array reference.
    expect(treeAfter).not.toBe(treeBefore);

    const rect2 = treeAfter.find((n) => n.id === "rect2");
    expect(rect2?.x).toBe(777);
  });
});
