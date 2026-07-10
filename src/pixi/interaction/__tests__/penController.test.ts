import { describe, it, expect, beforeEach, vi } from "vitest";
import { createPenController } from "../penController";
import { useDrawModeStore } from "@/store/drawModeStore";
import { usePenToolStore } from "@/store/penToolStore";
import { resetStores } from "@/test/fixtures";
import type { InteractionContext } from "../types";

function makeController() {
  const context = {
    canvas: {} as HTMLCanvasElement,
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createPenController(context);
}

const pointerEvent = { button: 0 } as unknown as PointerEvent;

describe("penController pointermove cursor coalescing", () => {
  let rafCallbacks: FrameRequestCallback[];

  beforeEach(() => {
    resetStores();
    usePenToolStore.getState().resetDraft();
    useDrawModeStore.setState({ activeTool: "pen", isDrawing: false, drawStart: null, drawCurrent: null, pencilPoints: [] });

    rafCallbacks = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb: FrameRequestCallback) => {
        rafCallbacks.push(cb);
        return rafCallbacks.length;
      }),
    );
  });

  function flushRaf(): void {
    const callbacks = rafCallbacks;
    rafCallbacks = [];
    for (const cb of callbacks) cb(0);
  }

  it("does not write cursorWorld to the store synchronously on pointermove", () => {
    const pen = makeController();
    pen.handlePointerDown(pointerEvent, { x: 0, y: 0 });
    pen.handlePointerUp(pointerEvent, { x: 0, y: 0 });

    pen.handlePointerMove(pointerEvent, { x: 5, y: 5 });

    // The store write is deferred to the next animation frame — not applied yet.
    expect(usePenToolStore.getState().cursorWorld).toBeNull();
  });

  it("coalesces multiple pointermoves within a frame into a single store update using the latest position", () => {
    const pen = makeController();
    pen.handlePointerDown(pointerEvent, { x: 0, y: 0 });
    pen.handlePointerUp(pointerEvent, { x: 0, y: 0 });

    pen.handlePointerMove(pointerEvent, { x: 1, y: 1 });
    pen.handlePointerMove(pointerEvent, { x: 2, y: 2 });
    pen.handlePointerMove(pointerEvent, { x: 3, y: 3 });

    // Only one rAF should have been scheduled for the whole burst.
    expect(rafCallbacks).toHaveLength(1);

    flushRaf();

    expect(usePenToolStore.getState().cursorWorld).toEqual({ x: 3, y: 3 });
  });

  it("schedules a new frame for the next pointermove burst after a flush", () => {
    const pen = makeController();
    pen.handlePointerDown(pointerEvent, { x: 0, y: 0 });
    pen.handlePointerUp(pointerEvent, { x: 0, y: 0 });

    pen.handlePointerMove(pointerEvent, { x: 1, y: 1 });
    flushRaf();
    expect(usePenToolStore.getState().cursorWorld).toEqual({ x: 1, y: 1 });

    pen.handlePointerMove(pointerEvent, { x: 9, y: 9 });
    expect(rafCallbacks).toHaveLength(1);
    flushRaf();
    expect(usePenToolStore.getState().cursorWorld).toEqual({ x: 9, y: 9 });
  });
});
