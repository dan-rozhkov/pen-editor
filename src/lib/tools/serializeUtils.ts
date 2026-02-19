import type { FlatSceneNode } from "@/types/scene";

/**
 * Serialize a flat node to a plain JSON object with depth-limited children.
 * Shared between batchGet and batchDesign executor.
 */
export function serializeNodeToDepth(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  depth: number,
  options?: {
    resolveVars?: boolean;
    variableLookup?: Record<string, string>;
  },
): Record<string, unknown> | null {
  const node = nodesById[nodeId];
  if (!node) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  // Resolve variable bindings if requested
  if (options?.resolveVars && options.variableLookup) {
    const rec = node as unknown as Record<string, unknown>;
    const fillBinding = rec.fillBinding as { variableId: string } | undefined;
    if (fillBinding?.variableId && options.variableLookup[fillBinding.variableId]) {
      result.fill = options.variableLookup[fillBinding.variableId];
    }
    const strokeBinding = rec.strokeBinding as { variableId: string } | undefined;
    if (strokeBinding?.variableId && options.variableLookup[strokeBinding.variableId]) {
      result.stroke = options.variableLookup[strokeBinding.variableId];
    }
  }

  // Add children for container types
  const childIds = childrenById[nodeId];
  if (childIds && childIds.length > 0) {
    if (depth <= 0) {
      result.children = "...";
    } else {
      result.children = childIds
        .map((cid) =>
          serializeNodeToDepth(cid, nodesById, childrenById, depth - 1, options)
        )
        .filter(Boolean);
    }
  }

  return result;
}
