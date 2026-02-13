import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue } from "@/types/variable";
import type { FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

interface SearchPattern {
  type?: string;
  name?: string;
  reusable?: boolean;
}

/**
 * Serialize a flat node into a JSON-friendly object with children up to readDepth.
 */
function serializeNode(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  depth: number,
  resolveVars: boolean,
  variableLookup: Record<string, string>
): Record<string, unknown> | null {
  const node = nodesById[nodeId];
  if (!node) return null;

  const result: Record<string, unknown> = {};
  // Copy all non-undefined properties from the node
  for (const [key, value] of Object.entries(node)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }

  // Resolve variable bindings if requested
  if (resolveVars) {
    const rec = node as unknown as Record<string, unknown>;
    const fillBinding = rec.fillBinding as { variableId: string } | undefined;
    if (fillBinding?.variableId && variableLookup[fillBinding.variableId]) {
      result.fill = variableLookup[fillBinding.variableId];
    }
    const strokeBinding = rec.strokeBinding as { variableId: string } | undefined;
    if (strokeBinding?.variableId && variableLookup[strokeBinding.variableId]) {
      result.stroke = variableLookup[strokeBinding.variableId];
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
          serializeNode(cid, nodesById, childrenById, depth - 1, resolveVars, variableLookup)
        )
        .filter(Boolean);
    }
  }

  return result;
}

/**
 * Check if a node matches a search pattern.
 */
function matchesPattern(node: FlatSceneNode, pattern: SearchPattern): boolean {
  if (pattern.type !== undefined && node.type !== pattern.type) return false;
  if (pattern.name !== undefined) {
    const regex = new RegExp(pattern.name, "i");
    if (!regex.test(node.name ?? "")) return false;
  }
  if (pattern.reusable !== undefined) {
    const isReusable = node.type === "frame" && (node as { reusable?: boolean }).reusable === true;
    if (pattern.reusable !== isReusable) return false;
  }
  return true;
}

/**
 * Search the tree recursively for nodes matching patterns.
 */
function searchNodes(
  startIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  patterns: SearchPattern[],
  searchDepth: number | undefined,
  currentDepth: number
): string[] {
  const results: string[] = [];

  for (const id of startIds) {
    const node = nodesById[id];
    if (!node) continue;

    // Check if node matches any pattern
    for (const pattern of patterns) {
      if (matchesPattern(node, pattern)) {
        results.push(id);
        break; // Only add once even if multiple patterns match
      }
    }

    // Recurse into children if within search depth
    if (searchDepth === undefined || currentDepth < searchDepth) {
      const childIds = childrenById[id];
      if (childIds && childIds.length > 0) {
        results.push(
          ...searchNodes(childIds, nodesById, childrenById, patterns, searchDepth, currentDepth + 1)
        );
      }
    }
  }

  return results;
}

export const batchGet: ToolHandler = async (args) => {
  const patterns = args.patterns as SearchPattern[] | undefined;
  const nodeIds = args.nodeIds as string[] | undefined;
  const parentId = args.parentId as string | undefined;
  const readDepth = (args.readDepth as number) ?? 1;
  const searchDepth = args.searchDepth as number | undefined;
  const resolveVariables = args.resolveVariables as boolean | undefined;

  const { nodesById, childrenById, rootIds } = useSceneStore.getState();

  // Build variable lookup if resolving
  let variableLookup: Record<string, string> = {};
  if (resolveVariables) {
    const { variables } = useVariableStore.getState();
    const { activeTheme } = useThemeStore.getState();
    for (const v of variables) {
      variableLookup[v.id] = getVariableValue(v, activeTheme);
    }
  }

  const startIds = parentId
    ? childrenById[parentId] ?? []
    : rootIds;

  const resultIds: string[] = [];

  // Search by patterns
  if (patterns && patterns.length > 0) {
    resultIds.push(...searchNodes(startIds, nodesById, childrenById, patterns, searchDepth, 0));
  }

  // Read specific node IDs
  if (nodeIds && nodeIds.length > 0) {
    for (const id of nodeIds) {
      if (nodesById[id] && !resultIds.includes(id)) {
        resultIds.push(id);
      }
    }
  }

  // If neither patterns nor nodeIds specified, return top-level children
  if (!patterns && !nodeIds) {
    resultIds.push(...startIds);
  }

  // Serialize results with readDepth
  const results = resultIds
    .map((id) =>
      serializeNode(id, nodesById, childrenById, readDepth, !!resolveVariables, variableLookup)
    )
    .filter(Boolean);

  return JSON.stringify(results);
};
