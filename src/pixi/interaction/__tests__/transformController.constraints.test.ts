import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InteractionContext } from "../types";

vi.mock("../hitTesting", () => ({
  hitTestTransformHandle: vi.fn(),
  getResizeCursor: () => "nwse-resize",
}));

import { hitTestTransformHandle } from "../hitTesting";
import { createTransformController } from "../transformController";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { resetStores, seedScene } from "@/test/fixtures";

// seedScene(): frame1 "Screen" (100,100 400x300, autoLayout:false)
//   rect1 "Box" (10,20 100x50)
//   text1 "Title" (10,90 80x20)

function makeController() {
  const context = {
    canvas: document.createElement("canvas"),
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createTransformController(context);
}

const pointerEvent = { button: 0 } as unknown as PointerEvent;

// Resize frame1's bottom-right handle: frame world box is (100,100)-(500,400).
// Dragging br to (700, 600) grows the frame to 600x500 (delta +200 on both axes).
function mockBrHandle() {
  (hitTestTransformHandle as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    nodeId: "frame1",
    corner: "br",
    width: 400,
    height: 300,
    absX: 100,
    absY: 100,
    slotContext: null,
  });
}

beforeEach(() => {
  resetStores();
  seedScene();
  vi.clearAllMocks();
});

describe("transformController: frame resize with constraints", () => {
  it("stretch (horizontal) + min (vertical): width grows with the frame delta, position/height untouched", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      constraints: { horizontal: "stretch", vertical: "min" },
    });
    mockBrHandle();
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 100, y: 100 });
    ctrl.handlePointerMove(pointerEvent, { x: 700, y: 600 });

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1).toMatchObject({ x: 10, y: 20, width: 300, height: 50 });
  });

  it("max (both axes): pinned to the bottom-right, position shifts by the full delta", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      constraints: { horizontal: "max", vertical: "max" },
    });
    mockBrHandle();
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 100, y: 100 });
    ctrl.handlePointerMove(pointerEvent, { x: 700, y: 600 });

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1).toMatchObject({ x: 210, y: 220, width: 100, height: 50 });
  });

  it("scale (both axes): position and size scale with the frame's resize ratio", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      constraints: { horizontal: "scale", vertical: "scale" },
    });
    mockBrHandle();
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 100, y: 100 });
    // Grow width x1.5 (400->600), height x1.5 isn't exact with +200 on 300 (->500,
    // a 5/3 ratio) — use a resize that keeps a clean scale factor instead.
    ctrl.handlePointerMove(pointerEvent, { x: 700, y: 550 }); // 600w x 450h => x1.5 both axes

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1.x).toBeCloseTo(15);
    expect(rect1.y).toBeCloseTo(30);
    expect(rect1.width).toBeCloseTo(150);
    expect(rect1.height).toBeCloseTo(75);
  });

  it("no constraints set (default min/min): children stay fixed regardless of frame resize", () => {
    mockBrHandle();
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 100, y: 100 });
    ctrl.handlePointerMove(pointerEvent, { x: 700, y: 600 });

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    const text1 = useSceneStore.getState().nodesById["text1"];
    expect(rect1).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });
    expect(text1).toMatchObject({ x: 10, y: 90, width: 80, height: 20 });
  });

  it("ignores constraints for children of an auto-layout frame", () => {
    useSceneStore.setState((state) => ({
      nodesById: {
        ...state.nodesById,
        frame1: {
          ...state.nodesById.frame1,
          layout: { ...(state.nodesById.frame1 as { layout?: object }).layout, autoLayout: true },
        },
      },
    }));
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      constraints: { horizontal: "stretch", vertical: "stretch" },
    });
    mockBrHandle();
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 100, y: 100 });
    ctrl.handlePointerMove(pointerEvent, { x: 700, y: 600 });

    // rect1's stored fields are untouched — auto-layout frames compute child
    // positions via Yoga (layoutStore), not from constraints.
    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1).toMatchObject({ x: 10, y: 20, width: 100, height: 50 });

    // The frame itself still resizes.
    const frame1 = useSceneStore.getState().nodesById["frame1"];
    expect(frame1).toMatchObject({ width: 600, height: 500 });
  });

  it("commits the frame + all constrained children as a single history entry on pointer up", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      constraints: { horizontal: "stretch", vertical: "min" },
    });
    mockBrHandle();
    const ctrl = makeController();
    const pastBefore = useHistoryStore.getState().past.length;

    ctrl.handlePointerDown(pointerEvent, { x: 100, y: 100 });
    ctrl.handlePointerMove(pointerEvent, { x: 700, y: 600 });
    ctrl.handlePointerUp(pointerEvent, { x: 700, y: 600 });

    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1).toMatchObject({ width: 300 });
    const frame1 = useSceneStore.getState().nodesById["frame1"];
    expect(frame1).toMatchObject({ width: 600, height: 500 });
  });
});
