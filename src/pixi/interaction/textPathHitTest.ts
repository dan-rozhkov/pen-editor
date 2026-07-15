import type { FlatSceneNode, PathAnchor, PathNode, TextNode } from "@/types/scene";
import { svgPathToAnchors } from "@/utils/pathAnchors";
import { getClosestPointOnPath } from "@/utils/pathMeasure";

/**
 * Pure geometry helpers for the "text on a path" tool
 * (`textPathController.ts`): finding which path node a click/hover lands
 * near, and converting a `PathNode` into the `TextNode` it becomes. Split out
 * from the Pixi-facing controller so the conversion logic (which the task
 * spec calls out as needing care — fill/effects migration, no dangling path
 * node) is unit-testable without a canvas/PixiJS.
 */

export interface PathHoverHit {
  nodeId: string;
  /** World-space distance from the query point to the path's nearest point. */
  distance: number;
}

/**
 * Resolve a path node's structured anchors, deriving them from `geometry`
 * (the SVG `d` string) for legacy paths that don't carry a `points` array yet
 * — the same lazy-derivation fallback `pathEditMode.ts` uses on entering
 * point-edit mode. Returns null for geometry `svgPathToAnchors` can't parse
 * (compound paths, arcs) — out of scope for text-on-path, same as point-edit.
 */
export function resolvePathAnchors(
  node: Pick<PathNode, "points" | "closed" | "geometry">,
): { points: PathAnchor[]; closed: boolean } | null {
  if (node.points && node.points.length > 0) {
    return { points: node.points, closed: node.closed ?? false };
  }
  return svgPathToAnchors(node.geometry);
}

// Absent `geometryBounds` means the geometry lives in the node's local
// 0..width/0..height box — same convention `pathRenderer.drawPath` and
// `pathEditGeometry.ts`'s `anchorToWorld` use.
function fallbackGeometryBounds(node: Pick<PathNode, "width" | "height">) {
  return { x: 0, y: 0, width: node.width, height: node.height };
}

function transformPoint(
  node: Pick<PathNode, "width" | "height" | "geometryBounds">,
  origin: { x: number; y: number },
  point: { x: number; y: number },
): { x: number; y: number } {
  const gb = node.geometryBounds ?? fallbackGeometryBounds(node);
  const scaleX = gb.width !== 0 ? node.width / gb.width : 1;
  const scaleY = gb.height !== 0 ? node.height / gb.height : 1;
  return {
    x: origin.x + (point.x - gb.x) * scaleX,
    y: origin.y + (point.y - gb.y) * scaleY,
  };
}

/**
 * Transform anchors from the path node's raw geometry space into another
 * origin's coordinate space (world space when `origin` is the node's
 * absolute position; the node's own local 0..width/0..height box — matching
 * `TextNode.textPath.points`'s convention, which has no separate
 * `geometryBounds` scale field — when `origin` is `{0, 0}`). Bakes in
 * whatever non-uniform scale the source path had, same as
 * `applyAnchorEditToNode` does for in-place path edits.
 */
export function transformAnchors(
  node: Pick<PathNode, "width" | "height" | "geometryBounds">,
  origin: { x: number; y: number },
  points: PathAnchor[],
): PathAnchor[] {
  return points.map((p) => {
    const pos = transformPoint(node, origin, p);
    return {
      x: pos.x,
      y: pos.y,
      handleIn: p.handleIn ? transformPoint(node, origin, p.handleIn) : undefined,
      handleOut: p.handleOut ? transformPoint(node, origin, p.handleOut) : undefined,
    };
  });
}

/**
 * Find the path node whose curve is closest to a world point, within
 * `maxDistance` world units. `getAbsPos` resolves a node's absolute
 * (world-space) position — injected so this stays independent of the store/
 * layout engine and unit-testable with a plain map.
 */
export function findClosestPathNode(
  worldX: number,
  worldY: number,
  nodesById: Record<string, FlatSceneNode>,
  getAbsPos: (id: string) => { x: number; y: number } | null,
  maxDistance: number,
): PathHoverHit | null {
  let best: PathHoverHit | null = null;
  for (const [id, node] of Object.entries(nodesById)) {
    if (node.type !== "path") continue;
    if (node.visible === false || node.enabled === false) continue;
    const anchors = resolvePathAnchors(node);
    if (!anchors || anchors.points.length < 2) continue;
    const absPos = getAbsPos(id);
    if (!absPos) continue;
    const worldAnchors = transformAnchors(node, absPos, anchors.points);
    const closest = getClosestPointOnPath(worldAnchors, anchors.closed, worldX, worldY);
    if (!closest) continue;
    if (closest.distance <= maxDistance && (!best || closest.distance < best.distance)) {
      best = { nodeId: id, distance: closest.distance };
    }
  }
  return best;
}

/**
 * Build the `TextNode` a `PathNode` converts into (the text-on-path tool's
 * click action). Per the task spec: the path's `points`/`closed` copy over
 * 1:1 (transformed into the node-local box `textPath.points` lives in — see
 * `transformAnchors`'s doc comment), and fill/effects migrate onto the new
 * text layer — no separate path node remains after conversion.
 */
/**
 * Move `id` to `index` within `ids` (a `rootIds` or `childrenById[frameId]`
 * array), removing it from wherever it currently sits first. Used by the
 * text-on-path conversion tool to restore the converted node's original
 * stacking position — `addNode`/`addChildToFrame` always append to the end,
 * so without this a path with siblings above it would visually jump to the
 * front on conversion. Pure (array in, array out) so it's unit-testable
 * without the store; `index` is clamped to the valid range so a stale/absent
 * original index degrades to "append" rather than throwing.
 */
export function reinsertAtIndex(ids: string[], id: string, index: number): string[] {
  const without = ids.filter((existing) => existing !== id);
  const clamped = Math.max(0, Math.min(index, without.length));
  const next = without.slice();
  next.splice(clamped, 0, id);
  return next;
}

export function buildTextPathNodeFromPath(pathNode: PathNode, newId: string): TextNode {
  const anchors = resolvePathAnchors(pathNode);
  const points = anchors ? transformAnchors(pathNode, { x: 0, y: 0 }, anchors.points) : [];
  const closed = anchors?.closed ?? false;

  // Fill migration: prefer the path's own fill stack/solid fill; a
  // stroke-only path (no fill) falls back to its stroke color so the
  // converted text isn't invisible.
  const strokeColor = pathNode.pathStroke?.fill ?? pathNode.stroke;
  const hasFill = pathNode.fills || pathNode.fill || pathNode.gradientFill;

  const node: TextNode = {
    id: newId,
    type: "text",
    name: pathNode.name,
    x: pathNode.x,
    y: pathNode.y,
    width: pathNode.width,
    height: pathNode.height,
    rotation: pathNode.rotation,
    opacity: pathNode.opacity,
    text: "Text",
    textPath: {
      points,
      closed,
      startOffset: 0,
      side: "left",
    },
    ...(pathNode.fills
      ? { fills: pathNode.fills }
      : hasFill
        ? {
            fill: pathNode.fill,
            fillBinding: pathNode.fillBinding,
            fillOpacity: pathNode.fillOpacity,
            gradientFill: pathNode.gradientFill,
          }
        : strokeColor
          ? { fill: strokeColor }
          : {}),
    ...(pathNode.effects ? { effects: pathNode.effects } : pathNode.effect ? { effect: pathNode.effect } : {}),
  };

  return node;
}
