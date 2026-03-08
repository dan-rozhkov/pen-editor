import type { EmbedNode, FlatSceneNode, SceneNode } from "@/types/scene";

/**
 * Find a component (EmbedNode with isComponent: true) by ID from flat store.
 */
export function findComponentByIdFlat(
  nodesById: Record<string, FlatSceneNode>,
  id: string,
): EmbedNode | null {
  const node = nodesById[id];
  if (node && node.type === "embed" && (node as EmbedNode).isComponent) {
    return node as EmbedNode;
  }
  return null;
}

/**
 * Get all component embeds from flat store.
 */
export function getAllComponentsFlat(
  nodesById: Record<string, FlatSceneNode>,
): EmbedNode[] {
  return Object.values(nodesById).filter(
    (n): n is EmbedNode => n.type === "embed" && !!(n as EmbedNode).isComponent,
  );
}

/**
 * Find a component (EmbedNode with isComponent: true) by ID in a tree.
 * Legacy tree-based lookup for backward compat.
 */
export function findComponentById(
  nodes: SceneNode[],
  id: string,
): EmbedNode | null {
  for (const node of nodes) {
    if (node.id === id && node.type === "embed" && (node as EmbedNode).isComponent) {
      return node as EmbedNode;
    }
    if (node.type === "frame" || node.type === "group") {
      const found = findComponentById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get all component embeds from the scene tree.
 */
export function getAllComponents(nodes: SceneNode[]): EmbedNode[] {
  const components: EmbedNode[] = [];

  function collect(searchNodes: SceneNode[]) {
    for (const node of searchNodes) {
      if (node.type === "embed" && (node as EmbedNode).isComponent) {
        components.push(node as EmbedNode);
      }
      if (node.type === "frame" || node.type === "group") {
        collect(node.children);
      }
    }
  }

  collect(nodes);
  return components;
}
