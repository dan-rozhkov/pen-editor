import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FlatSceneNode } from "@/types/scene";
import type { InteractionContext } from "../types";

// Mock the animator: these tests assert the controller's lifecycle decisions
// (deferred start, cancel-on-no-commit), not the container animation itself
// (covered by autoLayoutDragAnimator.test.ts).
const h = vi.hoisted(() => ({
  animator: {
    start: vi.fn(),
    updateCursorWorld: vi.fn(),
    updateInsertIndex: vi.fn(),
    animateDrop: vi.fn(() => Promise.resolve()),
    cancel: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock("@/pixi/autoLayoutDragAnimator", () => ({
  createAutoLayoutDragAnimator: () => h.animator,
}));

import { createDragController } from "../dragController";
import { useSceneStore } from "@/store/sceneStore";
import { useDragStore } from "@/store/dragStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";

// Auto-layout column frame at world (300, 200) with two 50x50 children.
// The stored child x/y are deliberately stale garbage — layout positions for
// auto-layout children live only in the computed layout, never in the store.
function seedAutoLayoutScene(): void {
  const frame = {
    id: "frame",
    type: "frame",
    name: "Card",
    x: 300,
    y: 200,
    width: 200,
    height: 300,
    fill: "#ffffff",
    layout: {
      autoLayout: true,
      flexDirection: "column",
      gap: 10,
      paddingTop: 30,
      paddingRight: 20,
      paddingBottom: 30,
      paddingLeft: 20,
    },
  } as unknown as FlatSceneNode;
  const child1 = {
    id: "child1",
    type: "rect",
    name: "A",
    x: 999,
    y: 999,
    width: 50,
    height: 50,
    fill: "#ff0000",
  } as unknown as FlatSceneNode;
  const child2 = {
    id: "child2",
    type: "rect",
    name: "B",
    x: 999,
    y: 999,
    width: 50,
    height: 50,
    fill: "#00ff00",
  } as unknown as FlatSceneNode;

  useSceneStore.setState({
    nodesById: { frame, child1, child2 },
    parentById: { frame: null, child1: "frame", child2: "frame" },
    childrenById: { frame: ["child1", "child2"] },
    rootIds: ["frame"],
    _cachedTree: null,
  });
}

function makeController() {
  const context = {
    canvas: document.createElement("canvas"),
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createDragController(context);
}

const pointerEvent = {
  button: 0,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
} as unknown as PointerEvent;

// child1's layout position: frame-local (20, 30) → world (320, 230).
const CHILD1_CENTER = { x: 345, y: 255 };

beforeEach(() => {
  vi.clearAllMocks();
  useSelectionStore.setState({ selectedIds: [], lastSelectedId: null });
  useHistoryStore.setState({ past: [], future: [], batchMode: false });
  useDragStore.getState().endDrag();
  seedAutoLayoutScene();
});

describe("dragController auto-layout drag lifecycle", () => {
  it("a plain click (no movement) never lifts the node or starts a drag-store drag", () => {
    const controller = makeController();
    const nodesBefore = useSceneStore.getState().nodesById;
    const childrenBefore = useSceneStore.getState().childrenById;

    expect(controller.handlePointerDown(pointerEvent, CHILD1_CENTER, "child1")).toBe(true);
    expect(useDragStore.getState().isDragging).toBe(false);
    expect(h.animator.start).not.toHaveBeenCalled();

    expect(controller.handlePointerUp(pointerEvent, CHILD1_CENTER)).toBe(true);

    expect(h.animator.start).not.toHaveBeenCalled();
    expect(h.animator.destroy).not.toHaveBeenCalled();
    expect(useDragStore.getState().isDragging).toBe(false);
    // No scene mutation: identical store references.
    expect(useSceneStore.getState().nodesById).toBe(nodesBefore);
    expect(useSceneStore.getState().childrenById).toBe(childrenBefore);
    expect(controller.isDragging()).toBe(false);
  });

  it("movement below the threshold keeps the lift deferred", () => {
    const controller = makeController();
    controller.handlePointerDown(pointerEvent, CHILD1_CENTER, "child1");

    expect(
      controller.handlePointerMove(pointerEvent, {
        x: CHILD1_CENTER.x + 2,
        y: CHILD1_CENTER.y,
      }),
    ).toBe(true);

    expect(useDragStore.getState().isDragging).toBe(false);
    expect(h.animator.start).not.toHaveBeenCalled();
  });

  it("movement past the threshold starts the drag and passes the parent frame origin to the animator", () => {
    const controller = makeController();
    controller.handlePointerDown(pointerEvent, CHILD1_CENTER, "child1");
    controller.handlePointerMove(pointerEvent, {
      x: CHILD1_CENTER.x + 10,
      y: CHILD1_CENTER.y,
    });

    expect(useDragStore.getState().isDragging).toBe(true);
    expect(h.animator.start).toHaveBeenCalledTimes(1);
    const config = h.animator.start.mock.calls[0][0];
    expect(config).toMatchObject({
      draggedId: "child1",
      parentId: "frame",
      parentAbsX: 300,
      parentAbsY: 200,
      // child1 layout position: frame (300,200) + padding (20,30)
      startAbsX: 320,
      startAbsY: 230,
      isHorizontal: false,
    });
  });

  it("a drop with no insert target restores containers via animator.cancel()", () => {
    const controller = makeController();
    controller.handlePointerDown(pointerEvent, CHILD1_CENTER, "child1");
    controller.handlePointerMove(pointerEvent, {
      x: CHILD1_CENTER.x + 10,
      y: CHILD1_CENTER.y,
    });

    // Simulate an exit where no drop target was computed: without a scene
    // mutation no sync flush re-applies layout, so the controller must
    // restore the animator-moved containers itself.
    useDragStore.getState().updateDrop(null, null, false);
    const nodesBefore = useSceneStore.getState().nodesById;
    const childrenBefore = useSceneStore.getState().childrenById;

    expect(controller.handlePointerUp(pointerEvent, CHILD1_CENTER)).toBe(true);

    expect(h.animator.cancel).toHaveBeenCalledTimes(1);
    expect(h.animator.destroy).toHaveBeenCalledTimes(1);
    expect(useDragStore.getState().isDragging).toBe(false);
    expect(useSceneStore.getState().nodesById).toBe(nodesBefore);
    expect(useSceneStore.getState().childrenById).toBe(childrenBefore);
  });

  it("a drop with an insert target commits via moveNode and does not cancel", async () => {
    const controller = makeController();
    controller.handlePointerDown(pointerEvent, CHILD1_CENTER, "child1");
    // Move inside the frame past the threshold — calculateDropPosition will
    // produce an insertInfo for the parent frame.
    controller.handlePointerMove(pointerEvent, {
      x: CHILD1_CENTER.x,
      y: CHILD1_CENTER.y + 80,
    });
    expect(useDragStore.getState().insertInfo).not.toBeNull();

    const childrenBefore = useSceneStore.getState().childrenById;
    controller.handlePointerUp(pointerEvent, {
      x: CHILD1_CENTER.x,
      y: CHILD1_CENTER.y + 80,
    });
    // The drop animation promise resolves in a microtask before committing.
    await Promise.resolve();
    await Promise.resolve();

    expect(h.animator.cancel).not.toHaveBeenCalled();
    expect(h.animator.destroy).toHaveBeenCalledTimes(1);
    expect(useDragStore.getState().isDragging).toBe(false);
    // moveNode rebuilt the children list (identity change ⇒ relayout flush).
    expect(useSceneStore.getState().childrenById).not.toBe(childrenBefore);
    expect(useSceneStore.getState().childrenById["frame"]).toHaveLength(2);
  });
});
