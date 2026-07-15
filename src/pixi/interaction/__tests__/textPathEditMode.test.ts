import { describe, it, expect, beforeEach } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import type { PathAnchor, SceneNode, TextNode } from "@/types/scene";
import { enterTextPathEditMode } from "../pathEditMode";
import { getEditedAnchorTarget } from "../pathEditGeometry";
import { createPathEditController } from "../pathEditController";
import type { InteractionContext } from "../types";

function makeTextOnPathNode(id: string, points: PathAnchor[]): SceneNode {
  return {
    id,
    type: "text",
    name: "Curved text",
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    text: "Hello",
    textPath: {
      points,
      closed: false,
      startOffset: 0,
      side: "left",
    },
  } as SceneNode;
}

const STRAIGHT_POINTS: PathAnchor[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
];

function makeController() {
  const context = {
    canvas: { style: {} } as HTMLCanvasElement,
    screenToWorld: (x: number, y: number) => ({ x, y }),
    isSpaceHeld: () => false,
  } as unknown as InteractionContext;
  return createPathEditController(context);
}

const pointerEvent = { button: 0, altKey: false } as unknown as PointerEvent;

describe("enterTextPathEditMode", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("enters text-path edit mode on a text node with textPath", () => {
    const node = makeTextOnPathNode("curved1", STRAIGHT_POINTS);
    useSceneStore.getState().addNode(node);

    const ok = enterTextPathEditMode("curved1");
    expect(ok).toBe(true);

    const selection = useSelectionStore.getState();
    expect(selection.editingNodeId).toBe("curved1");
    expect(selection.editingMode).toBe("text-path");
    expect(selection.selectedIds).toEqual(["curved1"]);
  });

  it("returns false for a plain text node (no textPath)", () => {
    const ok = enterTextPathEditMode("text1");
    expect(ok).toBe(false);
    expect(useSelectionStore.getState().editingMode).toBeNull();
  });

  it("returns false for a non-text node", () => {
    const ok = enterTextPathEditMode("rect1");
    expect(ok).toBe(false);
    expect(useSelectionStore.getState().editingMode).toBeNull();
  });
});

describe("getEditedAnchorTarget — text-path branch", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("exposes textPath.points/closed with identity scale (no geometryBounds) and a working applyEdit", () => {
    const node = makeTextOnPathNode("curved2", STRAIGHT_POINTS);
    useSceneStore.getState().addNode(node);
    enterTextPathEditMode("curved2");

    // Auto-width mode (the default) resyncs width/height to the path's own
    // bbox on add — a flat line's bbox has ~zero height, so this is *not*
    // the 100x50 the node literal specified.
    const stored = useSceneStore.getState().nodesById["curved2"] as unknown as TextNode;

    const target = getEditedAnchorTarget();
    expect(target).not.toBeNull();
    expect(target!.kind).toBe("text-path");
    expect(target!.points).toEqual(STRAIGHT_POINTS);
    expect(target!.closed).toBe(false);
    expect(target!.scaleBasis.geometryBounds).toBeUndefined();
    expect(target!.scaleBasis.width).toBe(stored.width);
    expect(target!.scaleBasis.height).toBe(stored.height);

    const nextPoints = [{ x: 5, y: 5 }, { x: 100, y: 0 }];
    const partial = target!.applyEdit(nextPoints, true);
    expect(partial).toEqual({
      textPath: { points: nextPoints, closed: true, startOffset: 0, side: "left" },
    });
  });

  it("returns null when not in text-path (or path) edit mode", () => {
    const node = makeTextOnPathNode("curved3", STRAIGHT_POINTS);
    useSceneStore.getState().addNode(node);
    useSelectionStore.getState().select("curved3");
    // Selected but not editing.
    expect(getEditedAnchorTarget()).toBeNull();
  });
});

describe("pathEditController — dragging an anchor on a text-on-path node", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
  });

  it("moves the anchor, keeps a single history checkpoint, and re-flows text (width/height re-derive from the new bbox)", () => {
    const node = makeTextOnPathNode("curved4", STRAIGHT_POINTS);
    useSceneStore.getState().addNode(node);
    enterTextPathEditMode("curved4");

    const before = useSceneStore.getState().nodesById["curved4"] as unknown as TextNode;

    const controller = makeController();
    const historyBefore = useHistoryStore.getState().past.length;

    // Anchor 0 sits at (0,0) in world space (node at origin, no parent).
    const down = controller.handlePointerDown(pointerEvent, { x: 0, y: 0 });
    expect(down).toBe(true);
    expect(controller.isDragging()).toBe(true);

    controller.handlePointerMove(pointerEvent, { x: 0, y: 40 });

    const afterMove = useSceneStore.getState().nodesById["curved4"] as unknown as TextNode;
    expect(afterMove.textPath!.points[0]).toEqual({ x: 0, y: 40 });
    // The path now spans y in [0,40] (anchor1 stays at y=0) instead of the
    // original near-flat line — "live re-flow" means width/height (which
    // auto-derive from the path bbox in the default "auto" width mode) pick
    // this up immediately, not just on some later explicit resync.
    expect(afterMove.height).toBeGreaterThan(before.height);

    controller.handlePointerUp(pointerEvent, { x: 0, y: 40 });
    expect(controller.isDragging()).toBe(false);

    // One drag gesture -> exactly one history checkpoint (saved lazily on
    // the first pointermove that actually moves), regardless of how many
    // intermediate pointermove events fired.
    expect(useHistoryStore.getState().past.length).toBe(historyBefore + 1);
  });

  it("leaves a PathNode drag byte-identical to before the generic refactor (regression guard)", () => {
    const pathNode: SceneNode = {
      id: "plainPath1",
      type: "path",
      name: "Plain",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      geometry: "M0,0 L10,0 L10,10 L0,10 Z",
      geometryBounds: { x: 0, y: 0, width: 10, height: 10 },
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
      closed: true,
    } as SceneNode;
    useSceneStore.getState().addNode(pathNode);
    useSelectionStore.getState().select("plainPath1");
    useSelectionStore.getState().startEditing("plainPath1", "path");

    const controller = makeController();
    controller.handlePointerDown(pointerEvent, { x: 0, y: 0 });
    controller.handlePointerMove(pointerEvent, { x: 3, y: 4 });

    const after = useSceneStore.getState().nodesById["plainPath1"] as unknown as {
      points: PathAnchor[];
      geometry: string;
    };
    expect(after.points[0]).toEqual({ x: 3, y: 4 });
    expect(after.geometry).toContain("3,4");
  });
});
