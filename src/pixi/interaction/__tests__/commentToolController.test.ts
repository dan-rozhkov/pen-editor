import { beforeEach, describe, expect, it } from "vitest";
import { createCommentToolController } from "../commentToolController";
import type { CommentToolRect } from "../commentToolController";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useCommentsStore } from "@/store/commentsStore";
import type { InteractionContext } from "../types";

const context = {} as InteractionContext;

const RECTS: Record<string, CommentToolRect> = {
  rect1: { x: 100, y: 200, width: 50, height: 40 },
};

function fakeHitTest(map: Record<string, string>) {
  return (x: number, y: number): string | null => map[`${x},${y}`] ?? null;
}
const getRect = (id: string): CommentToolRect | null => RECTS[id] ?? null;

beforeEach(() => {
  useDrawModeStore.setState({ activeTool: "comment" });
  useCommentsStore.setState({ threads: [], draftAnchor: null, pinsHidden: false });
});

describe("commentToolController", () => {
  it("is a no-op when the comment tool is not active", () => {
    useDrawModeStore.setState({ activeTool: "cursor" });
    const c = createCommentToolController(context, { hitTest: fakeHitTest({}), getRect });
    const handled = c.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 0, y: 0 });
    expect(handled).toBe(false);
    expect(useCommentsStore.getState().draftAnchor).toBeNull();
  });

  it("clicking a node starts a node-anchored draft with ox/oy from the click point", () => {
    const c = createCommentToolController(context, {
      hitTest: fakeHitTest({ "125,220": "rect1" }),
      getRect,
    });
    const handled = c.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 125, y: 220 });
    expect(handled).toBe(true);
    expect(useCommentsStore.getState().draftAnchor).toEqual({
      kind: "node",
      nodeId: "rect1",
      ox: 0.5,
      oy: 0.5,
    });
  });

  it("clicking empty canvas starts a canvas-anchored draft at the world point", () => {
    const c = createCommentToolController(context, { hitTest: fakeHitTest({}), getRect });
    const handled = c.handlePointerDown(new PointerEvent("pointerdown", { button: 0 }), { x: 42, y: 84 });
    expect(handled).toBe(true);
    expect(useCommentsStore.getState().draftAnchor).toEqual({ kind: "canvas", x: 42, y: 84 });
  });

  it("ignores non-primary buttons", () => {
    const c = createCommentToolController(context, { hitTest: fakeHitTest({}), getRect });
    const handled = c.handlePointerDown(new PointerEvent("pointerdown", { button: 2 }), { x: 0, y: 0 });
    expect(handled).toBe(false);
  });
});
