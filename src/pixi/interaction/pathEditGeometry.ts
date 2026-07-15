import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { applyAnchorEditToNode, computeAnchorsBBox } from "@/utils/pathAnchors";
import type { PathAnchor, PathNode, SceneNode, TextNode } from "@/types/scene";

/**
 * Shared geometry helpers for path point-edit mode, used by both the
 * pointer-interaction controller (hit-testing) and the Pixi overlay renderer
 * (drawing anchors/handles) so the two stay pixel-perfect in sync.
 *
 * Anchor world position = node's absolute position + (anchor - geometryBounds
 * origin) scaled by width/geometryBounds.width (height respectively) — the
 * exact same convention `pathRenderer.ts` uses to place the Graphics inside
 * the node's box (see `applyAnchorEditToNode` in `@/utils/pathAnchors`).
 */

export interface AnchorScreenPoint {
  index: number;
  pos: { x: number; y: number };
  handleIn?: { x: number; y: number };
  handleOut?: { x: number; y: number };
}

export type PathEditHit =
  | { kind: "anchor"; index: number }
  | { kind: "handle"; index: number; which: "in" | "out" };

/**
 * A geometry currently under anchor-edit (dragging anchors/handles) — either
 * a `PathNode`'s own `points`, or a text-on-path `TextNode`'s `textPath.points`.
 * Both share the same `PathAnchor[]` model (see `pathAnchors.ts`), so the
 * pointer-interaction controller and the overlay renderer can drive either
 * one through this single shape instead of branching on node type
 * everywhere. `scaleBasis` feeds `anchorToWorld`/`worldDeltaToAnchorDelta`
 * (identity scale for text-path — see its construction below); `applyEdit`
 * produces the store update for a new points/closed pair, keeping each
 * node type's own persistence shape (PathNode's `geometry`/`geometryBounds`
 * recompute vs. TextNode's `textPath` object) private to this module.
 */
export interface AnchorEditTarget {
  id: string;
  kind: "path" | "text-path";
  points: PathAnchor[];
  closed: boolean;
  scaleBasis: Pick<PathNode, "width" | "height" | "geometryBounds" | "x" | "y">;
  applyEdit: (points: PathAnchor[], closed: boolean) => Partial<SceneNode>;
}

/**
 * The node currently in anchor-edit mode (`editingMode` is `"path"` or
 * `"text-path"` — see `pathEditMode.ts`'s `enterPathEditMode`/
 * `enterTextPathEditMode`), or null if nothing is being anchor-edited.
 */
export function getEditedAnchorTarget(): AnchorEditTarget | null {
  const { editingNodeId, editingMode } = useSelectionStore.getState();
  if (!editingNodeId) return null;
  const node = useSceneStore.getState().nodesById[editingNodeId];
  if (!node) return null;

  if (editingMode === "path") {
    if (node.type !== "path" || !node.points) return null;
    const pathNode = node as unknown as PathNode;
    return {
      id: editingNodeId,
      kind: "path",
      points: pathNode.points ?? [],
      closed: pathNode.closed ?? false,
      scaleBasis: pathNode,
      applyEdit: (points, closed) => applyAnchorEditToNode(pathNode, points, closed),
    };
  }

  if (editingMode === "text-path") {
    if (node.type !== "text" || !node.textPath) return null;
    const textNode = node as unknown as TextNode;
    const tp = textNode.textPath!;
    return {
      id: editingNodeId,
      kind: "text-path",
      points: tp.points,
      closed: tp.closed ?? false,
      // `textPath.points` are stored directly in the node's local 0..width/
      // 0..height box, with no separate `geometryBounds` scale field (see
      // `textPathHitTest.ts`'s doc comment) — omitting `geometryBounds` here
      // makes `anchorToWorld`'s fallback kick in, which is exactly scale 1
      // against the node's own width/height, i.e. no rescaling at all.
      scaleBasis: { width: textNode.width, height: textNode.height, x: textNode.x, y: textNode.y },
      // Unlike `PathNode` (which keeps a `geometryBounds` field so its box
      // can float anywhere relative to the raw points), a text-path node's
      // points are REQUIRED to already be in the node's local 0-origin box —
      // there is nowhere else to record an origin offset. So an edit that
      // moves the bbox's origin (e.g. dragging the leftmost anchor further
      // left) must rebase every point back onto a 0-origin box and shift
      // `x`/`y` by the same delta to keep the curve's world position
      // unchanged — the same invariant `applyAnchorEditToNode` maintains for
      // `PathNode` via `geometryBounds`, just inlined here since there's no
      // separate bounds field to update.
      applyEdit: (points, closed) => {
        const newGB = computeAnchorsBBox(points, closed);
        const rebase = (p: { x: number; y: number }) => ({ x: p.x - newGB.x, y: p.y - newGB.y });
        const rebasedPoints: PathAnchor[] = points.map((p) => ({
          x: p.x - newGB.x,
          y: p.y - newGB.y,
          handleIn: p.handleIn ? rebase(p.handleIn) : p.handleIn,
          handleOut: p.handleOut ? rebase(p.handleOut) : p.handleOut,
        }));
        return {
          textPath: { ...tp, points: rebasedPoints, closed },
          x: textNode.x + newGB.x,
          y: textNode.y + newGB.y,
        } as Partial<SceneNode>;
      },
    };
  }

  return null;
}

export function getNodeAbsolutePosition(nodeId: string): { x: number; y: number } | null {
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  return getNodeAbsolutePositionWithLayout(useSceneStore.getState().getNodes(), nodeId, calculateLayoutForFrame);
}

// When `geometryBounds` is absent (e.g. Figma-pasted vectors), the geometry
// lives in the node's local 0..width/0..height box, exactly what the renderer
// assumes: `pathRenderer.drawPath` applies no transform (scale 1, origin 0,0)
// and the container is placed at (node.x, node.y). The fallback must therefore
// use origin {0, 0} — NOT {node.x, node.y} — or the overlay draws anchors
// offset from the shape by (node.x, node.y).
function fallbackGeometryBounds(node: Pick<PathNode, "width" | "height">): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return { x: 0, y: 0, width: node.width, height: node.height };
}

function getScale(node: Pick<PathNode, "width" | "height" | "geometryBounds">): { scaleX: number; scaleY: number } {
  const gb = node.geometryBounds ?? fallbackGeometryBounds(node);
  return {
    scaleX: gb.width !== 0 ? node.width / gb.width : 1,
    scaleY: gb.height !== 0 ? node.height / gb.height : 1,
  };
}

export function anchorToWorld(
  node: Pick<PathNode, "width" | "height" | "geometryBounds">,
  absPos: { x: number; y: number },
  point: { x: number; y: number },
): { x: number; y: number } {
  const gb = node.geometryBounds ?? fallbackGeometryBounds(node);
  const { scaleX, scaleY } = getScale(node);
  return {
    x: absPos.x + (point.x - gb.x) * scaleX,
    y: absPos.y + (point.y - gb.y) * scaleY,
  };
}

/** Convert a world-space delta into the anchor/geometry coordinate space. */
export function worldDeltaToAnchorDelta(
  node: Pick<PathNode, "width" | "height" | "geometryBounds" | "x" | "y">,
  dx: number,
  dy: number,
): { dx: number; dy: number } {
  const { scaleX, scaleY } = getScale(node);
  return {
    dx: scaleX !== 0 ? dx / scaleX : dx,
    dy: scaleY !== 0 ? dy / scaleY : dy,
  };
}

export function getAnchorScreenPoints(
  points: PathAnchor[],
  scaleBasis: Pick<PathNode, "width" | "height" | "geometryBounds">,
  absPos: { x: number; y: number },
): AnchorScreenPoint[] {
  return points.map((anchor, index) => ({
    index,
    pos: anchorToWorld(scaleBasis, absPos, anchor),
    handleIn: anchor.handleIn ? anchorToWorld(scaleBasis, absPos, anchor.handleIn) : undefined,
    handleOut: anchor.handleOut ? anchorToWorld(scaleBasis, absPos, anchor.handleOut) : undefined,
  }));
}

const HIT_RADIUS_PX = 7;

/** Hit-test anchors/handles at a world point against the currently edited node. */
export function hitTestPathEdit(worldX: number, worldY: number): PathEditHit | null {
  const edited = getEditedAnchorTarget();
  if (!edited) return null;
  const absPos = getNodeAbsolutePosition(edited.id);
  if (!absPos) return null;

  const scale = useViewportStore.getState().scale || 1;
  const radius = HIT_RADIUS_PX / scale;
  const screenPoints = getAnchorScreenPoints(edited.points, edited.scaleBasis, absPos);

  // Handles are checked first — they sit closer to the anchor when the
  // handle is short, and should win the hit-test since anchors are more
  // numerous / easier to hit accidentally.
  for (const sp of screenPoints) {
    if (sp.handleOut) {
      const dx = worldX - sp.handleOut.x;
      const dy = worldY - sp.handleOut.y;
      if (dx * dx + dy * dy <= radius * radius) return { kind: "handle", index: sp.index, which: "out" };
    }
    if (sp.handleIn) {
      const dx = worldX - sp.handleIn.x;
      const dy = worldY - sp.handleIn.y;
      if (dx * dx + dy * dy <= radius * radius) return { kind: "handle", index: sp.index, which: "in" };
    }
  }
  for (const sp of screenPoints) {
    const dx = worldX - sp.pos.x;
    const dy = worldY - sp.pos.y;
    if (dx * dx + dy * dy <= radius * radius) return { kind: "anchor", index: sp.index };
  }
  return null;
}

/** First-anchor proximity test, for closing an in-progress pen draft. */
export function isNearWorldPoint(worldX: number, worldY: number, point: { x: number; y: number }, scale: number): boolean {
  const radius = HIT_RADIUS_PX / (scale || 1);
  const dx = worldX - point.x;
  const dy = worldY - point.y;
  return dx * dx + dy * dy <= radius * radius;
}
