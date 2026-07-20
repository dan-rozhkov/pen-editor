import { usePenToolStore } from "@/store/penToolStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { anchorsToSVGPath, computeAnchorsBBox } from "@/utils/pathAnchors";
import { generateId } from "@/types/scene";
import type { PathAnchor, SceneNode } from "@/types/scene";
import { addDrawnNodeWithAutoParenting } from "./autoParentPlacement";

// An open path needs at least 2 anchors (one segment); a closed contour
// needs at least 3 (otherwise it's just a doubled-back line).
const MIN_ANCHORS_OPEN = 2;
const MIN_ANCHORS_CLOSED = 3;

/**
 * Finalize the in-progress pen-tool draft into a real `path` node (or
 * silently discard it if too few anchors were placed), and exit the pen
 * tool. Used for: clicking the first anchor to close the contour, and
 * Esc/Enter to finish an open path.
 */
export function finishPenDraft(closed: boolean): void {
  const pen = usePenToolStore.getState();
  if (!pen.isDrafting) return;

  const anchors: PathAnchor[] = [...pen.anchors];
  // Commit any handle-drag still in flight (e.g. user pressed Enter mid-drag).
  if (pen.pendingAnchor) anchors.push(pen.pendingAnchor);

  pen.resetDraft();
  useDrawModeStore.getState().setActiveTool(null);

  const minAnchors = closed ? MIN_ANCHORS_CLOSED : MIN_ANCHORS_OPEN;
  if (anchors.length < minAnchors) return;

  const bbox = computeAnchorsBBox(anchors, closed);
  const geometry = anchorsToSVGPath(anchors, closed);

  const id = generateId();
  const node: SceneNode = {
    id,
    type: "path",
    name: "Path",
    x: bbox.x,
    y: bbox.y,
    width: bbox.width,
    height: bbox.height,
    geometry,
    geometryBounds: bbox,
    points: anchors,
    closed,
    pathStroke: {
      fill: "#000000",
      thickness: 2,
      join: "round",
      cap: "round",
      align: "center",
    },
  };

  addDrawnNodeWithAutoParenting(node, bbox, id);
}

/** Discard the in-progress pen draft entirely (no node created) and exit the tool. */
export function cancelPenDraft(): void {
  usePenToolStore.getState().resetDraft();
  useDrawModeStore.getState().setActiveTool(null);
}
