import type { SceneNode, FrameNode, GroupNode } from "../types/scene";
import type { ThemeName } from "../types/variable";
import { isContainerNode } from "../types/scene";
import { findComponentById as findComponentByIdImpl, getAllComponents as getAllComponentsImpl } from "./componentUtils";
import { getPreparedNodeEffectiveSize, prepareFrameNode } from "@/components/nodes/instanceUtils";

export interface ParentContext {
  parent: FrameNode | GroupNode | null;
  isInsideAutoLayout: boolean;
}

/**
 * Find parent container (Frame or Group) for a node by its ID
 * Returns parent context with isInsideAutoLayout flag
 */
export function findParentFrame(
  nodes: SceneNode[],
  targetId: string,
): ParentContext {
  // Recursive search in children
  function searchInChildren(
    children: SceneNode[],
    parent: FrameNode | GroupNode | null,
  ): ParentContext | null {
    for (const node of children) {
      if (node.id === targetId) {
        return {
          parent,
          isInsideAutoLayout:
            (parent?.type === "frame" && parent?.layout?.autoLayout) ?? false,
        };
      }

      if (isContainerNode(node)) {
        const found = searchInChildren(node.children, node);
        if (found) return found;
      }
    }
    return null;
  }

  // First check top level
  for (const node of nodes) {
    if (node.id === targetId) {
      return { parent: null, isInsideAutoLayout: false };
    }
  }

  // Search in container children
  for (const node of nodes) {
    if (isContainerNode(node)) {
      const found = searchInChildren(node.children, node);
      if (found) return found;
    }
  }

  return { parent: null, isInsideAutoLayout: false };
}

/**
 * Recursively find a node by ID in the scene tree
 */
export function findNodeById(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (isContainerNode(node)) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get absolute position of a node by traversing parent chain
 * Returns the accumulated x,y from all parent frames
 */
export function getNodeAbsolutePosition(
  nodes: SceneNode[],
  targetId: string,
): { x: number; y: number } | null {
  function findWithPath(
    searchNodes: SceneNode[],
    accX: number,
    accY: number,
  ): { x: number; y: number } | null {
    for (const node of searchNodes) {
      if (node.id === targetId) {
        return { x: accX + node.x, y: accY + node.y };
      }
      if (isContainerNode(node)) {
        const found = findWithPath(node.children, accX + node.x, accY + node.y);
        if (found) return found;
      }
    }
    return null;
  }

  return findWithPath(nodes, 0, 0);
}

/**
 * Find a component (reusable FrameNode) by ID
 * Searches the entire tree for a FrameNode with matching ID and reusable: true
 */
export function findComponentById(
  nodes: SceneNode[],
  id: string,
): FrameNode | null {
  return findComponentByIdImpl(nodes, id);
}

/**
 * Get all components (reusable FrameNodes) from the scene tree
 */
export function getAllComponents(nodes: SceneNode[]): FrameNode[] {
  return getAllComponentsImpl(nodes);
}

/**
 * Check if targetId is a descendant of ancestorId anywhere in the node tree.
 * Used for nested selection to determine if a container is an ancestor of the entered container.
 */
export function isDescendantOf(
  nodes: SceneNode[],
  ancestorId: string,
  targetId: string,
): boolean {
  // First find the ancestor node
  const ancestor = findNodeById(nodes, ancestorId);
  if (!ancestor || !isContainerNode(ancestor)) return false;

  // Then check if targetId is nested inside it
  function searchIn(children: SceneNode[]): boolean {
    for (const child of children) {
      if (child.id === targetId) return true;
      if (isContainerNode(child)) {
        if (searchIn(child.children)) return true;
      }
    }
    return false;
  }

  return searchIn(ancestor.children);
}

/**
 * Get all ancestor IDs for a node by walking the parent chain upwards.
 * Returns ancestors from immediate parent to root (bottom-up order).
 */
export function getAncestorIds(
  parentById: Record<string, string | null>,
  nodeId: string,
): string[] {
  const ancestors: string[] = [];
  let current = parentById[nodeId];
  while (current != null) {
    ancestors.push(current);
    current = parentById[current];
  }
  return ancestors;
}

/**
 * Resolve effective theme for a node by walking ancestor frames.
 * Frame `themeOverride` affects descendants, not the frame itself.
 */
export function getThemeFromAncestorFrames(
  parentById: Record<string, string | null>,
  nodesById: Record<string, { type: string; themeOverride?: ThemeName }>,
  nodeId: string,
  fallbackTheme: ThemeName,
): ThemeName {
  const ancestors = getAncestorIds(parentById, nodeId);
  let theme: ThemeName = fallbackTheme;

  // Apply from root ancestor down to immediate parent.
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestor = nodesById[ancestors[i]];
    if (ancestor?.type === "frame" && ancestor.themeOverride) {
      theme = ancestor.themeOverride;
    }
  }

  return theme;
}

/**
 * Resolve effective theme for a target node inside an arbitrary scene subtree.
 */
export function findEffectiveThemeInTree(
  nodes: SceneNode[],
  targetId: string,
  fallbackTheme: ThemeName,
): ThemeName | null {
  const search = (items: SceneNode[], inheritedTheme: ThemeName): ThemeName | null => {
    for (const node of items) {
      if (node.id === targetId) {
        return inheritedTheme;
      }
      if (isContainerNode(node)) {
        const childTheme =
          node.type === "frame" && node.themeOverride
            ? node.themeOverride
            : inheritedTheme;
        const found = search(node.children, childTheme);
        if (found) return found;
      }
    }
    return null;
  };

  return search(nodes, fallbackTheme);
}

/**
 * Check if targetId is a descendant of ancestorId using the flat parentById map.
 * O(depth) instead of O(n) — walks the parent chain from targetId upwards.
 */
export function isDescendantOfFlat(
  parentById: Record<string, string | null>,
  ancestorId: string,
  targetId: string,
): boolean {
  let current = parentById[targetId];
  while (current != null) {
    if (current === ancestorId) return true;
    current = parentById[current];
  }
  return false;
}

/**
 * Get absolute position of a node, taking into account Yoga layout calculations
 * for auto-layout frames. This is necessary because children inside auto-layout
 * frames have their positions computed by Yoga, not stored in node.x/y.
 */
export function getNodeAbsolutePositionWithLayout(
  nodes: SceneNode[],
  targetId: string,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { x: number; y: number } | null {
  function findWithPath(
    searchNodes: SceneNode[],
    accX: number,
    accY: number,
    parentFrame: FrameNode | null,
  ): { x: number; y: number } | null {
    // If parent is an auto-layout frame, use prepared children for consistent layout resolution.
    let effectiveNodes = searchNodes;
    if (parentFrame?.layout?.autoLayout) {
      effectiveNodes = prepareFrameNode(parentFrame, calculateLayoutForFrame).layoutChildren;
    }

    for (const node of effectiveNodes) {
      if (node.id === targetId) {
        return { x: accX + node.x, y: accY + node.y };
      }
      if (isContainerNode(node)) {
        const found = findWithPath(
          node.children,
          accX + node.x,
          accY + node.y,
          node.type === "frame" ? node : null,
        );
        if (found) return found;
      }
    }
    return null;
  }

  return findWithPath(nodes, 0, 0, null);
}

/**
 * Get effective size of a node, taking into account Yoga layout calculations.
 * For nodes inside auto-layout frames, width/height may be computed by Yoga.
 * For fit_content frames, intrinsic size is calculated.
 */
export function getNodeEffectiveSize(
  nodes: SceneNode[],
  targetId: string,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { width: number; height: number } | null {
  function findWithPath(
    searchNodes: SceneNode[],
    parentFrame: FrameNode | null,
  ): { width: number; height: number } | null {
    // If parent is an auto-layout frame, use prepared children for consistent layout resolution.
    let effectiveNodes = searchNodes;
    if (parentFrame?.layout?.autoLayout) {
      effectiveNodes = prepareFrameNode(parentFrame, calculateLayoutForFrame).layoutChildren;
    }

    for (const node of effectiveNodes) {
      if (node.id === targetId) {
        return getPreparedNodeEffectiveSize(node, nodes, calculateLayoutForFrame);
      }
      if (isContainerNode(node)) {
        const found = findWithPath(
          node.children,
          node.type === "frame" ? node : null,
        );
        if (found) return found;
      }
    }
    return null;
  }

  return findWithPath(nodes, null);
}

/**
 * Find a child node at the given local coordinates (relative to parent)
 * Returns the ID of the child at that position, or null if none found
 * Searches from top to bottom (last child to first) for correct z-order
 */
export function findChildAtPosition(
  children: SceneNode[],
  localX: number,
  localY: number,
): string | null {
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.visible === false || child.enabled === false) continue;
    if (
      localX >= child.x &&
      localX <= child.x + child.width &&
      localY >= child.y &&
      localY <= child.y + child.height
    ) {
      return child.id;
    }
  }
  return null;
}

/**
 * Find the deepest (most nested) child node at the given local coordinates.
 * Coordinates are relative to the current parent node.
 */
export function findDeepestChildAtPosition(
  children: SceneNode[],
  localX: number,
  localY: number,
): string | null {
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child.visible === false || child.enabled === false) continue;
    if (
      localX >= child.x &&
      localX <= child.x + child.width &&
      localY >= child.y &&
      localY <= child.y + child.height
    ) {
      if (isContainerNode(child)) {
        const nestedId = findDeepestChildAtPosition(
          child.children,
          localX - child.x,
          localY - child.y,
        );
        if (nestedId) return nestedId;
      }
      return child.id;
    }
  }
  return null;
}

interface AbsoluteRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FrameHitResult {
  frame: FrameNode;
  absoluteX: number;
  absoluteY: number;
}

function rectsIntersect(a: AbsoluteRect, b: AbsoluteRect): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Find the top-most/deepest frame that intersects with a world-space rectangle.
 * Useful for inserting freshly created nodes into a frame under them.
 */
export function findTopmostFrameIntersectingRectWithLayout(
  nodes: SceneNode[],
  targetRect: AbsoluteRect,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): FrameHitResult | null {
  function search(
    searchNodes: SceneNode[],
    accX: number,
    accY: number,
    parentFrame: FrameNode | null,
  ): FrameHitResult | null {
    let effectiveNodes = searchNodes;
    if (parentFrame?.layout?.autoLayout) {
      effectiveNodes = prepareFrameNode(parentFrame, calculateLayoutForFrame).layoutChildren;
    }

    for (let i = effectiveNodes.length - 1; i >= 0; i--) {
      const node = effectiveNodes[i];
      if (node.visible === false || node.enabled === false) continue;

      const { width, height } = getPreparedNodeEffectiveSize(
        node,
        nodes,
        calculateLayoutForFrame,
      );
      const absX = accX + node.x;
      const absY = accY + node.y;
      const nodeRect: AbsoluteRect = { x: absX, y: absY, width, height };

      if (!rectsIntersect(targetRect, nodeRect)) continue;

      if (isContainerNode(node)) {
        const childHit = search(
          node.children,
          absX,
          absY,
          node.type === "frame" ? node : null,
        );
        if (childHit) return childHit;
      }

      if (node.type === "frame") {
        return { frame: node, absoluteX: absX, absoluteY: absY };
      }
    }

    return null;
  }

  return search(nodes, 0, 0, null);
}

/**
 * Find the nearest parent frame for a node inside a component tree.
 * Used for Shift+Enter to select the parent container in instance editing.
 */
export function findParentFrameInComponent(
  children: SceneNode[],
  targetId: string,
  parent: FrameNode,
): FrameNode | null {
  for (const child of children) {
    if (child.id === targetId) return parent;
    if (child.type === "frame") {
      const found = findParentFrameInComponent(child.children, targetId, child);
      if (found) return found;
    } else if (child.type === "group") {
      const found = findParentFrameInComponent(
        (child as GroupNode).children,
        targetId,
        parent,
      );
      if (found) return found;
    }
  }
  return null;
}
