import { describe, it, expect, beforeEach } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import type { SceneNode, TextNode } from "@/types/scene";
import { createTextPathOffsetController, getActiveStartOffsetHandlePos } from "../textPathOffsetController";
import type { InteractionContext } from "../types";

function makeTextOnPathNode(id: string): SceneNode {
  return {
    id,
    type: "text",
    name: "Curved",
    x: 0,
    y: 0,
    width: 100,
    height: 1,
    text: "Hi",
    textPath: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      closed: false,
      startOffset: 0,
      side: "left",
    },
  } as SceneNode;
}

function makeController() {
  const context = {
    canvas: { style: {} } as HTMLCanvasElement,
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createTextPathOffsetController(context);
}

const pointerEvent = { button: 0 } as unknown as PointerEvent;

describe("textPathOffsetController", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("is inactive with no selection, or a non-text-path selection", () => {
    const controller = makeController();
    expect(controller.isActive()).toBe(false);

    useSelectionStore.getState().select("rect1");
    expect(controller.isActive()).toBe(false);
  });

  it("is active when the sole selection is a text-on-path node", () => {
    useSceneStore.getState().addNode(makeTextOnPathNode("curved1"));
    useSelectionStore.getState().select("curved1");

    const controller = makeController();
    expect(controller.isActive()).toBe(true);
  });

  it("misses a pointerdown away from the handle (does not swallow the click)", () => {
    useSceneStore.getState().addNode(makeTextOnPathNode("curved2"));
    useSelectionStore.getState().select("curved2");

    const controller = makeController();
    const handled = controller.handlePointerDown(pointerEvent, { x: 500, y: 500 });
    expect(handled).toBe(false);
    expect(controller.isDragging()).toBe(false);
  });

  it("drags the handle along the curve, updating startOffset live and saving one history checkpoint", () => {
    useSceneStore.getState().addNode(makeTextOnPathNode("curved3"));
    useSelectionStore.getState().select("curved3");
    const historyBefore = useHistoryStore.getState().past.length;

    const controller = makeController();
    // Handle starts at world (0,0) (startOffset 0 on a node at the origin).
    const down = controller.handlePointerDown(pointerEvent, { x: 0, y: 0 });
    expect(down).toBe(true);
    expect(controller.isDragging()).toBe(true);

    controller.handlePointerMove(pointerEvent, { x: 30, y: 0 });
    let node = useSceneStore.getState().nodesById["curved3"] as unknown as TextNode;
    expect(node.textPath!.startOffset).toBeCloseTo(0.3, 2);

    controller.handlePointerMove(pointerEvent, { x: 70, y: 0 });
    node = useSceneStore.getState().nodesById["curved3"] as unknown as TextNode;
    expect(node.textPath!.startOffset).toBeCloseTo(0.7, 2);

    controller.handlePointerUp(pointerEvent, { x: 70, y: 0 });
    expect(controller.isDragging()).toBe(false);

    // One drag gesture (however many pointermoves) -> one history checkpoint.
    expect(useHistoryStore.getState().past.length).toBe(historyBefore + 1);
  });

  it("getActiveStartOffsetHandlePos tracks the node's current startOffset", () => {
    useSceneStore.getState().addNode(makeTextOnPathNode("curved4"));
    useSelectionStore.getState().select("curved4");

    expect(getActiveStartOffsetHandlePos()).toEqual({ x: 0, y: 0 });

    useSceneStore.getState().updateNode("curved4", {
      textPath: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        closed: false,
        startOffset: 0.5,
        side: "left",
      },
    } as Partial<SceneNode>);

    const pos = getActiveStartOffsetHandlePos();
    expect(pos!.x).toBeCloseTo(50, 1);
  });

  it("returns null when nothing is selected", () => {
    expect(getActiveStartOffsetHandlePos()).toBeNull();
  });
});
