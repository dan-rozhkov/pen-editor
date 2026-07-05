import type { FlatSceneNode } from "@/types/scene";
import { combinePolygons, ringsToPolygon, type BooleanOpKind } from "./booleanCombine";
import { nodeToParentSpaceRings } from "./nodeToPolygon";
import { polygonsToPath, type PathBuildResult } from "./polygonToPath";
import type { NodeTransform } from "./transform";

export type { BooleanOpKind } from "./booleanCombine";
export { BOOLEAN_SUPPORTED_TYPES } from "./nodeToPolygon";

export interface BooleanOpInput {
  node: FlatSceneNode;
  /** Effective bounds in shared parent-local space (falls back to node.x/y/width/height for non-auto-layout children). */
  bounds: NodeTransform;
}

/**
 * Combine an ordered (bottom-to-top z-order) list of shape nodes into a single
 * flattened path using the requested boolean operation. Returns `null` when
 * the result is empty (e.g. subtracting a shape that fully covers the base).
 */
export function computeBooleanOp(op: BooleanOpKind, inputs: BooleanOpInput[]): PathBuildResult | null {
  if (inputs.length === 0) return null;

  const polygons = inputs.map(({ node, bounds }) => ringsToPolygon(nodeToParentSpaceRings(node, bounds)));
  const combined = combinePolygons(op, polygons);
  return polygonsToPath(combined);
}
