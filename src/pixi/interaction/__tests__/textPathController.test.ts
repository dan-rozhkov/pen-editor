import { describe, it, expect, beforeEach } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import type { PathNode, SceneNode } from "@/types/scene";
import { createTextPathController } from "../textPathController";
import type { InteractionContext } from "../types";

function makeController() {
  const context = {
    canvas: { style: {} } as HTMLCanvasElement,
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createTextPathController(context);
}

const pointerEvent = { button: 0 } as unknown as PointerEvent;

describe("textPathController — click-to-convert atomic undo + z-order", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useDrawModeStore.setState({ activeTool: "text-path" });
  });

  it("converting a root-level path is a single undo step", () => {
    const pathNode: SceneNode = {
      id: "rootPath",
      type: "path",
      name: "Line",
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      geometry: "M0,0 L100,0",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      closed: false,
    } as SceneNode;
    useSceneStore.getState().addNode(pathNode);
    // addNode above is a distinct, pre-existing history entry — the
    // assertions below only care about the delta the conversion itself adds.
    const historyBefore = useHistoryStore.getState().past.length;

    const tool = makeController();
    const handled = tool.handlePointerDown(pointerEvent, { x: 50, y: 0 });
    expect(handled).toBe(true);

    // Old path gone, new text-on-path node present.
    expect(useSceneStore.getState().nodesById["rootPath"]).toBeUndefined();
    const newIds = useSceneStore.getState().rootIds.filter((id) => id !== "frame1" && id !== "rect2");
    expect(newIds).toHaveLength(1);
    const newId = newIds[0];
    expect(useSceneStore.getState().nodesById[newId].type).toBe("text");

    // Exactly one history entry for the whole conversion (delete + add would
    // otherwise be two, leaving a broken half-state on a single Cmd+Z).
    expect(useHistoryStore.getState().past.length).toBe(historyBefore + 1);

    // Single undo fully restores the original path — not a half-converted state.
    const snapshot = createSnapshot(useSceneStore.getState());
    const restored = useHistoryStore.getState().undo(snapshot);
    expect(restored).not.toBeNull();
    useSceneStore.getState().restoreSnapshot(restored!);

    expect(useSceneStore.getState().nodesById["rootPath"]).toBeDefined();
    expect(useSceneStore.getState().nodesById["rootPath"].type).toBe("path");
    expect(useSceneStore.getState().nodesById[newId]).toBeUndefined();
  });

  it("preserves the original path's stacking position among its frame siblings", () => {
    const pathNode: PathNode = {
      id: "framePath",
      type: "path",
      name: "Line",
      x: 0,
      y: 250,
      width: 50,
      height: 0,
      geometry: "M0,0 L50,0",
      points: [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      closed: false,
    } as unknown as PathNode;

    useSceneStore.setState((s) => ({
      nodesById: { ...s.nodesById, framePath: pathNode as unknown as SceneNode as never },
      parentById: { ...s.parentById, framePath: "frame1" },
      // Inserted between rect1 and text1.
      childrenById: { ...s.childrenById, frame1: ["rect1", "framePath", "text1"] },
    }));

    const tool = makeController();
    // frame1 is at (100,100), non-auto-layout — path-local (0,250)-(50,250)
    // lands at world (100,350)-(150,350).
    const handled = tool.handlePointerDown(pointerEvent, { x: 125, y: 350 });
    expect(handled).toBe(true);

    const children = useSceneStore.getState().childrenById["frame1"];
    expect(children).toHaveLength(3);
    expect(children[0]).toBe("rect1");
    expect(children[2]).toBe("text1");
    // The converted text node took the path's old middle slot, not the end.
    const middleId = children[1];
    expect(middleId).not.toBe("framePath");
    expect(useSceneStore.getState().nodesById[middleId].type).toBe("text");
  });

  it("selects the new node and deactivates the tool after conversion", () => {
    const pathNode: SceneNode = {
      id: "rootPath2",
      type: "path",
      name: "Line",
      x: 0,
      y: 0,
      width: 100,
      height: 0,
      geometry: "M0,0 L100,0",
      points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
      closed: false,
    } as SceneNode;
    useSceneStore.getState().addNode(pathNode);

    const tool = makeController();
    tool.handlePointerDown(pointerEvent, { x: 50, y: 0 });

    expect(useSelectionStore.getState().selectedIds).toHaveLength(1);
    expect(useDrawModeStore.getState().activeTool).toBeNull();
  });
});
