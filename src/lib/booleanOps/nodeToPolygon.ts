import type { FlatSceneNode } from "@/types/scene";
import type { Point } from "./svgPathFlatten";
import { ellipseToRing, pathGeometryToRings, pointsToRing, rectToRing } from "./shapeToRings";
import { transformRing, type NodeTransform } from "./transform";

/** Node types that can be converted to polygon rings for boolean ops. */
export const BOOLEAN_SUPPORTED_TYPES = new Set(["rect", "ellipse", "polygon", "path"]);

/**
 * Convert a shape node into polygon rings in the node's local (0,0)..(width,height)
 * box, i.e. before the node's own position/rotation/flip is applied.
 */
export function nodeToLocalRings(node: FlatSceneNode): Point[][] {
  switch (node.type) {
    case "rect":
      return [rectToRing(node.width, node.height, node.cornerRadius, node.cornerRadiusPerCorner)];
    case "ellipse":
      return [ellipseToRing(node.width, node.height)];
    case "polygon":
      return [pointsToRing(node.points)];
    case "path":
      return node.geometry
        ? pathGeometryToRings(node.geometry, node.width, node.height, node.geometryBounds)
        : [];
    default:
      return [];
  }
}

/**
 * Convert a shape node into polygon rings positioned in shared parent-local
 * space (using `bounds` in place of the node's own x/y/width/height so callers
 * can pass Yoga-resolved effective bounds for auto-layout children).
 */
export function nodeToParentSpaceRings(node: FlatSceneNode, bounds: NodeTransform): Point[][] {
  const localRings = nodeToLocalRings(node);
  const transform: NodeTransform = {
    ...bounds,
    rotation: node.rotation,
    flipX: node.flipX,
    flipY: node.flipY,
  };
  return localRings.map((ring) => transformRing(ring, transform));
}
