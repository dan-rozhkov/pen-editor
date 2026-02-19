import { useSceneStore } from "@/store/sceneStore";
import { useVariableStore } from "@/store/variableStore";
import { useThemeStore } from "@/store/themeStore";
import { getVariableValue } from "@/types/variable";
import type { FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";
import { serializeNodeToDepth } from "./serializeUtils";

interface SearchPattern {
  type?: string;
  name?: string;
  reusable?: boolean;
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
      serializeNodeToDepth(id, nodesById, childrenById, readDepth, {
        resolveVars: !!resolveVariables,
        variableLookup,
      })
    )
    .filter(Boolean);

  return JSON.stringify(results);
};
