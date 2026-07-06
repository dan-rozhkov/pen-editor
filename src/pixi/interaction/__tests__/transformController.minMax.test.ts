import { describe, it, expect, vi, beforeEach } from "vitest";
import type { InteractionContext } from "../types";

vi.mock("../hitTesting", () => ({
  hitTestTransformHandle: vi.fn(),
  getResizeCursor: () => "nwse-resize",
}));

import { hitTestTransformHandle } from "../hitTesting";
import { createTransformController } from "../transformController";
import { useSceneStore } from "@/store/sceneStore";
import { resetStores, seedScene } from "@/test/fixtures";

// seedScene(): frame1 "Screen" (100,100 400x300, autoLayout:false)
//   rect1 "Box" (10,20 100x50)
//   text1 "Title" (10,90 80x20)
// rect1's world box is (110,120)-(210,170) (frame origin 100,100 + local 10,20).

function makeController() {
  const context = {
    canvas: document.createElement("canvas"),
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createTransformController(context);
}

const pointerEvent = { button: 0 } as unknown as PointerEvent;

function mockHandle(
  nodeId: string,
  corner: string,
  opts: { width: number; height: number; absX: number; absY: number },
) {
  (hitTestTransformHandle as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
    nodeId,
    corner,
    width: opts.width,
    height: opts.height,
    absX: opts.absX,
    absY: opts.absY,
    slotContext: null,
  });
}

beforeEach(() => {
  resetStores();
  seedScene();
  vi.clearAllMocks();
});

describe("transformController: interactive resize clamps to sizing min/max", () => {
  it("clamps a bottom-right drag to maxWidth/maxHeight live during the drag", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      sizing: { maxWidth: 320, maxHeight: 200 },
    });
    mockHandle("rect1", "br", { width: 100, height: 50, absX: 110, absY: 120 });
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 110, y: 120 });
    // Drag far past the max: raw delta would give 600x600.
    ctrl.handlePointerMove(pointerEvent, { x: 710, y: 720 });

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1).toMatchObject({ x: 10, y: 20, width: 320, height: 200 });
  });

  it("does not clamp when the drag stays within maxWidth/maxHeight", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      sizing: { maxWidth: 320, maxHeight: 200 },
    });
    mockHandle("rect1", "br", { width: 100, height: 50, absX: 110, absY: 120 });
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 110, y: 120 });
    ctrl.handlePointerMove(pointerEvent, { x: 260, y: 220 }); // -> 150x100, under both maxes

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1).toMatchObject({ width: 150, height: 100 });
  });

  it("clamps to minWidth, anchoring the fixed (right) edge, when shrinking from the left handle", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      sizing: { minWidth: 80 },
    });
    // "l" handle: right edge (210) is the fixed anchor.
    mockHandle("rect1", "l", { width: 100, height: 50, absX: 110, absY: 120 });
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 110, y: 120 });
    // Drag the left edge far to the right, past what minWidth allows
    // (raw delta would shrink width to 10).
    ctrl.handlePointerMove(pointerEvent, { x: 300, y: 120 });

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    // Width floors at 80; the right edge (originally at local x=10+100=110,
    // world 210) stays fixed, so the new local x is 110 - 80 = 30 (in
    // world terms the left edge lands at 210 - 80 = 130, i.e. local x
    // shifts by the same amount the frame-relative position moved: 130 -
    // 100 (frame origin) = 30).
    expect(rect1.width).toBe(80);
    expect(rect1.x).toBe(30);
  });

  it("keeps the clamp applied after pointer up commits the resize", () => {
    useSceneStore.getState().updateNodeWithoutHistory("rect1", {
      sizing: { maxWidth: 320 },
    });
    mockHandle("rect1", "br", { width: 100, height: 50, absX: 110, absY: 120 });
    const ctrl = makeController();

    ctrl.handlePointerDown(pointerEvent, { x: 110, y: 120 });
    ctrl.handlePointerMove(pointerEvent, { x: 710, y: 220 });
    ctrl.handlePointerUp(pointerEvent, { x: 710, y: 220 });

    const rect1 = useSceneStore.getState().nodesById["rect1"];
    expect(rect1.width).toBe(320);
  });
});
