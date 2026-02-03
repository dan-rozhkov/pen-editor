import { create } from "zustand";
import type {
  SceneNode,
  FrameNode,
  GroupNode,
  RefNode,
  TextNode,
  DescendantOverride,
} from "../types/scene";
import { isContainerNode, generateId } from "../types/scene";
import { useHistoryStore } from "./historyStore";
import { useLayoutStore } from "./layoutStore";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "../utils/textMeasure";
import { loadGoogleFontsFromNodes, registerFontLoadCallback } from "../utils/fontUtils";
import { calculateFrameIntrinsicSize } from "../utils/yogaLayout";

interface SceneState {
  nodes: SceneNode[];
  nodesById: Record<string, SceneNode>;
  parentById: Record<string, string | null>;
  indexById: Record<string, number>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
  expandedFrameIds: Set<string>;
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  updateNodeWithoutHistory: (id: string, updates: Partial<SceneNode>) => void;
  deleteNode: (id: string) => void;
  clearNodes: () => void;
  setNodes: (nodes: SceneNode[]) => void;
  setNodesWithoutHistory: (nodes: SceneNode[]) => void;
  reorderNode: (fromIndex: number, toIndex: number) => void;
  setVisibility: (id: string, visible: boolean) => void;
  toggleVisibility: (id: string) => void;
  toggleFrameExpanded: (id: string) => void;
  setFrameExpanded: (id: string, expanded: boolean) => void;
  moveNode: (
    nodeId: string,
    newParentId: string | null,
    newIndex: number,
  ) => void;
  // Descendant override methods for component instances
  updateDescendantOverride: (
    instanceId: string,
    descendantId: string,
    updates: DescendantOverride,
  ) => void;
  resetDescendantOverride: (
    instanceId: string,
    descendantId: string,
    property?: keyof DescendantOverride,
  ) => void;
  // Group/ungroup operations
  groupNodes: (ids: string[]) => string | null;
  ungroupNodes: (ids: string[]) => string[];
  // Convert group↔frame
  convertNodeType: (id: string) => boolean;
  // Page-level properties
  pageBackground: string;
  setPageBackground: (color: string) => void;
}

interface SceneIndex {
  nodesById: Record<string, SceneNode>;
  parentById: Record<string, string | null>;
  indexById: Record<string, number>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}

function buildSceneIndex(nodes: SceneNode[]): SceneIndex {
  const nodesById: Record<string, SceneNode> = {};
  const parentById: Record<string, string | null> = {};
  const indexById: Record<string, number> = {};
  const childrenById: Record<string, string[]> = {};
  const rootIds = nodes.map((node) => node.id);

  const visit = (node: SceneNode, parentId: string | null, index: number) => {
    nodesById[node.id] = node;
    parentById[node.id] = parentId;
    indexById[node.id] = index;

    if (isContainerNode(node)) {
      const childIds = node.children.map((child) => child.id);
      childrenById[node.id] = childIds;
      node.children.forEach((child, childIndex) => {
        visit(child, node.id, childIndex);
      });
    }
  };

  nodes.forEach((node, index) => visit(node, null, index));

  return {
    nodesById,
    parentById,
    indexById,
    childrenById,
    rootIds,
  };
}

function withRebuiltIndex(nodes: SceneNode[]): {
  nodes: SceneNode[];
  nodesById: Record<string, SceneNode>;
  parentById: Record<string, string | null>;
  indexById: Record<string, number>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
} {
  const index = buildSceneIndex(nodes);
  return { nodes, ...index };
}

function addSubtreeToIndex(
  node: SceneNode,
  parentId: string | null,
  index: number,
  nodesById: Record<string, SceneNode>,
  parentById: Record<string, string | null>,
  indexById: Record<string, number>,
  childrenById: Record<string, string[]>,
) {
  nodesById[node.id] = node;
  parentById[node.id] = parentId;
  indexById[node.id] = index;

  if (isContainerNode(node)) {
    const childIds = node.children.map((child) => child.id);
    childrenById[node.id] = childIds;
    node.children.forEach((child, childIndex) => {
      addSubtreeToIndex(
        child,
        node.id,
        childIndex,
        nodesById,
        parentById,
        indexById,
        childrenById,
      );
    });
  }
}

function removeSubtreeFromIndex(
  nodeId: string,
  nodesById: Record<string, SceneNode>,
  parentById: Record<string, string | null>,
  indexById: Record<string, number>,
  childrenById: Record<string, string[]>,
) {
  const node = nodesById[nodeId];
  if (!node) return;
  if (isContainerNode(node)) {
    const childIds = childrenById[nodeId] ?? node.children.map((child) => child.id);
    for (const childId of childIds) {
      removeSubtreeFromIndex(childId, nodesById, parentById, indexById, childrenById);
    }
    delete childrenById[nodeId];
  }
  delete nodesById[nodeId];
  delete parentById[nodeId];
  delete indexById[nodeId];
}

function updateIndicesForList(
  ids: string[],
  indexById: Record<string, number>,
  startIndex = 0,
) {
  for (let i = startIndex; i < ids.length; i += 1) {
    indexById[ids[i]] = i;
  }
}

// Recursively sync text node dimensions throughout the tree
function syncAllTextDimensions(nodes: SceneNode[]): SceneNode[] {
  return nodes.map((node) => {
    if (node.type === "text") {
      return syncTextDimensions(node);
    }
    if (isContainerNode(node)) {
      return { ...node, children: syncAllTextDimensions(node.children) } as
        | FrameNode
        | GroupNode;
    }
    return node;
  });
}

// Helper to recursively add child to a container (frame or group)
function addChildToFrameRecursive(
  nodes: SceneNode[],
  frameId: string,
  child: SceneNode,
): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === frameId && isContainerNode(node)) {
      return { ...node, children: [...node.children, child] } as
        | FrameNode
        | GroupNode;
    }
    if (isContainerNode(node)) {
      return {
        ...node,
        children: addChildToFrameRecursive(node.children, frameId, child),
      } as FrameNode | GroupNode;
    }
    return node;
  });
}

// Properties that affect text measurement
const TEXT_MEASURE_PROPS = new Set([
  "text",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "textWidthMode",
]);

// Sync a text node's width/height based on its textWidthMode
function syncTextDimensions(node: SceneNode): SceneNode {
  if (node.type !== "text") return node;
  const textNode = node as TextNode;
  const mode = textNode.textWidthMode;

  if (!mode || mode === "auto") {
    // Auto mode: compute both width and height from content
    const measured = measureTextAutoSize(textNode);
    return { ...textNode, width: measured.width, height: measured.height };
  } else if (mode === "fixed") {
    // Fixed width mode: only recompute height (wrapping)
    const measuredHeight = measureTextFixedWidthHeight(textNode);
    return { ...textNode, height: measuredHeight };
  }
  // fixed-height: both are manual, no sync
  return textNode;
}

// Check if updates contain properties that affect text measurement
function hasTextMeasureProps(updates: Partial<SceneNode>): boolean {
  return Object.keys(updates).some((k) => TEXT_MEASURE_PROPS.has(k));
}

// Helper to recursively update a node anywhere in the tree
function updateNodeRecursive(
  nodes: SceneNode[],
  id: string,
  updates: Partial<SceneNode>,
): { nodes: SceneNode[]; found: boolean } {
  const nextNodes: SceneNode[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    if (node.id === id) {
      let updated = { ...node, ...updates } as SceneNode;
      // Auto-sync text dimensions when relevant properties change
      if (updated.type === "text" && hasTextMeasureProps(updates)) {
        updated = syncTextDimensions(updated);
      }
      nextNodes.push(updated, ...nodes.slice(i + 1));
      return { nodes: nextNodes, found: true };
    }

    if (isContainerNode(node)) {
      const result = updateNodeRecursive(node.children, id, updates);
      if (result.found) {
        nextNodes.push({ ...node, children: result.nodes } as FrameNode | GroupNode);
        nextNodes.push(...nodes.slice(i + 1));
        return { nodes: nextNodes, found: true };
      }
      nextNodes.push(node);
      continue;
    }

    nextNodes.push(node);
  }

  return { nodes, found: false };
}

function replaceNodeInTreeByIndex(
  nodes: SceneNode[],
  nodesById: Record<string, SceneNode>,
  parentById: Record<string, string | null>,
  indexById: Record<string, number>,
  nodeId: string,
  newNode: SceneNode,
): { nodes: SceneNode[]; nodesById: Record<string, SceneNode> } {
  const updatedNodesById = { ...nodesById, [nodeId]: newNode };
  let currentId = nodeId;
  let updatedChild = newNode;
  let parentId = parentById[currentId];

  while (parentId) {
    const parentNode = updatedNodesById[parentId] as FrameNode | GroupNode;
    const childIndex = indexById[currentId];
    const nextChildren = parentNode.children.slice();
    nextChildren[childIndex] = updatedChild;
    const updatedParent = { ...parentNode, children: nextChildren } as
      | FrameNode
      | GroupNode;
    updatedNodesById[parentId] = updatedParent;
    updatedChild = updatedParent;
    currentId = parentId;
    parentId = parentById[currentId];
  }

  const rootIndex = indexById[currentId];
  const nextNodes = nodes.slice();
  nextNodes[rootIndex] = updatedChild;

  return { nodes: nextNodes, nodesById: updatedNodesById };
}

// Helper to recursively delete a node anywhere in the tree
function deleteNodeRecursive(nodes: SceneNode[], id: string): SceneNode[] {
  return nodes.reduce<SceneNode[]>((acc, node) => {
    // Skip the node to delete
    if (node.id === id) return acc;
    // Recursively process container children
    if (isContainerNode(node)) {
      acc.push({ ...node, children: deleteNodeRecursive(node.children, id) } as
        | FrameNode
        | GroupNode);
    } else {
      acc.push(node);
    }
    return acc;
  }, []);
}

// Helper to recursively toggle visibility of a node anywhere in the tree
function toggleVisibilityRecursive(
  nodes: SceneNode[],
  id: string,
): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return {
        ...node,
        visible: node.visible === false ? true : false,
      } as SceneNode;
    }
    if (isContainerNode(node)) {
      return {
        ...node,
        children: toggleVisibilityRecursive(node.children, id),
      } as FrameNode | GroupNode;
    }
    return node;
  });
}

// Helper to recursively set visibility of a node anywhere in the tree
function setVisibilityRecursive(
  nodes: SceneNode[],
  id: string,
  visible: boolean,
): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, visible } as SceneNode;
    }
    if (isContainerNode(node)) {
      return {
        ...node,
        children: setVisibilityRecursive(node.children, id, visible),
      } as FrameNode | GroupNode;
    }
    return node;
  });
}

// Helper to insert a node at a specific index in a parent (or root if parentId is null)
function insertNodeRecursive(
  nodes: SceneNode[],
  nodeToInsert: SceneNode,
  parentId: string | null,
  index: number,
): SceneNode[] {
  if (parentId === null) {
    // Insert at root level
    const newNodes = [...nodes];
    newNodes.splice(index, 0, nodeToInsert);
    return newNodes;
  }

  return nodes.map((node) => {
    if (node.id === parentId && isContainerNode(node)) {
      const newChildren = [...node.children];
      newChildren.splice(index, 0, nodeToInsert);
      return { ...node, children: newChildren } as FrameNode | GroupNode;
    }
    if (isContainerNode(node)) {
      return {
        ...node,
        children: insertNodeRecursive(
          node.children,
          nodeToInsert,
          parentId,
          index,
        ),
      } as FrameNode | GroupNode;
    }
    return node;
  });
}

// Generic helper to recursively process nodes in the tree
function mapNodesRecursive(
  nodes: SceneNode[],
  processFn: (
    node: SceneNode,
    recurse: (children: SceneNode[]) => SceneNode[],
  ) => SceneNode,
): SceneNode[] {
  const recurse = (children: SceneNode[]) =>
    mapNodesRecursive(children, processFn);
  return nodes.map((node) => processFn(node, recurse));
}

// Helper to update descendant override in a RefNode
function updateDescendantOverrideRecursive(
  nodes: SceneNode[],
  instanceId: string,
  descendantId: string,
  updates: DescendantOverride,
): SceneNode[] {
  return mapNodesRecursive(nodes, (node, recurse) => {
    if (node.id === instanceId && node.type === "ref") {
      const refNode = node as RefNode;
      const existingOverrides = refNode.descendants || {};
      const existingDescendant = existingOverrides[descendantId] || {};

      return {
        ...refNode,
        descendants: {
          ...existingOverrides,
          [descendantId]: { ...existingDescendant, ...updates },
        },
      } as RefNode;
    }
    if (isContainerNode(node)) {
      return { ...node, children: recurse(node.children) } as
        | FrameNode
        | GroupNode;
    }
    return node;
  });
}

// Helper to reset descendant override (remove property or entire override)
function resetDescendantOverrideRecursive(
  nodes: SceneNode[],
  instanceId: string,
  descendantId: string,
  property?: keyof DescendantOverride,
): SceneNode[] {
  return mapNodesRecursive(nodes, (node, recurse) => {
    if (node.id === instanceId && node.type === "ref") {
      const refNode = node as RefNode;
      const existingOverrides = refNode.descendants || {};

      if (!existingOverrides[descendantId]) {
        return node;
      }

      if (property) {
        // Reset specific property
        const { [property]: _, ...remainingProps } =
          existingOverrides[descendantId];
        // If no properties left, remove the entire override
        if (Object.keys(remainingProps).length === 0) {
          const { [descendantId]: __, ...remainingOverrides } =
            existingOverrides;
          return {
            ...refNode,
            descendants:
              Object.keys(remainingOverrides).length > 0
                ? remainingOverrides
                : undefined,
          } as RefNode;
        }
        return {
          ...refNode,
          descendants: {
            ...existingOverrides,
            [descendantId]: remainingProps,
          },
        } as RefNode;
      } else {
        // Reset entire override for this descendant
        const { [descendantId]: _, ...remainingOverrides } = existingOverrides;
        return {
          ...refNode,
          descendants:
            Object.keys(remainingOverrides).length > 0
              ? remainingOverrides
              : undefined,
        } as RefNode;
      }
    }
    if (isContainerNode(node)) {
      return { ...node, children: recurse(node.children) } as
        | FrameNode
        | GroupNode;
    }
    return node;
  });
}

// Helper to find the index and parent of a node
function findNodePosition(
  nodes: SceneNode[],
  id: string,
  parentId: string | null = null,
): { parentId: string | null; index: number } | null {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].id === id) {
      return { parentId, index: i };
    }
    const node = nodes[i];
    if (isContainerNode(node)) {
      const found = findNodePosition(node.children, id, node.id);
      if (found) return found;
    }
  }
  return null;
}

// Helper to find a node by ID recursively
function findNodeInTree(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (isContainerNode(node)) {
      const found = findNodeInTree(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Generic helper to recursively process a specific level in the node tree
 * Walks through the tree until reaching the target parent ID, then applies the callback
 */
function processTreeAtLevel(
  nodes: SceneNode[],
  targetParentId: string | null,
  processTargetLevel: (levelNodes: SceneNode[]) => SceneNode[],
): SceneNode[] {
  function processLevel(
    levelNodes: SceneNode[],
    levelParentId: string | null,
  ): SceneNode[] {
    if (levelParentId !== targetParentId) {
      // Not the target level, recurse into containers
      return levelNodes.map((node) => {
        if (isContainerNode(node)) {
          return { ...node, children: processLevel(node.children, node.id) } as
            | FrameNode
            | GroupNode;
        }
        return node;
      });
    }

    // This is the target level - apply the callback
    return processTargetLevel(levelNodes);
  }

  return processLevel(nodes, null);
}

// Group selected nodes into a new GroupNode
function groupNodesInTree(
  nodes: SceneNode[],
  ids: string[],
  calculateLayoutForFrame?: (frame: FrameNode) => SceneNode[],
): { nodes: SceneNode[]; groupId: string } | null {
  if (ids.length < 2) return null;

  // Find positions of all nodes - they must all be in the same parent
  const positions = ids.map((id) => findNodePosition(nodes, id));
  if (positions.some((p) => p === null)) return null;
  const validPositions = positions as {
    parentId: string | null;
    index: number;
  }[];

  // All nodes must share the same parent
  const parentId = validPositions[0].parentId;
  if (!validPositions.every((p) => p.parentId === parentId)) return null;

  // Get the actual node objects
  const selectedNodes = ids
    .map((id) => findNodeInTree(nodes, id)!)
    .filter(Boolean);
  if (selectedNodes.length !== ids.length) return null;

  // If parent is an auto-layout frame, use Yoga-computed positions and dimensions
  // instead of stored values (which may not reflect actual rendered layout)
  let layoutNodes: SceneNode[] | null = null;
  if (parentId && calculateLayoutForFrame) {
    const parentNode = findNodeInTree(nodes, parentId);
    if (
      parentNode &&
      parentNode.type === "frame" &&
      (parentNode as FrameNode).layout?.autoLayout
    ) {
      layoutNodes = calculateLayoutForFrame(parentNode as FrameNode);
    }
  }

  // Build a map of layout-computed dimensions if available
  const layoutMap = new Map<string, SceneNode>();
  if (layoutNodes) {
    for (const ln of layoutNodes) {
      layoutMap.set(ln.id, ln);
    }
  }

  // Helper to get effective dimensions for a node, accounting for:
  // 1. Yoga layout-computed dimensions (for children of auto-layout parents)
  // 2. fit_content sizing modes (for auto-layout frames with hug-contents)
  function getEffectiveBounds(node: SceneNode): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const layoutNode = layoutMap.get(node.id);
    const x = layoutNode?.x ?? node.x;
    const y = layoutNode?.y ?? node.y;
    let width = layoutNode?.width ?? node.width;
    let height = layoutNode?.height ?? node.height;

    // For auto-layout frames with fit_content sizing, compute intrinsic size
    if (node.type === "frame") {
      const frame = node as FrameNode;
      if (frame.layout?.autoLayout) {
        const fitWidth = frame.sizing?.widthMode === "fit_content";
        const fitHeight = frame.sizing?.heightMode === "fit_content";
        if (fitWidth || fitHeight) {
          const intrinsic = calculateFrameIntrinsicSize(frame, {
            fitWidth,
            fitHeight,
          });
          if (fitWidth) width = intrinsic.width;
          if (fitHeight) height = intrinsic.height;
        }
      }
    }

    return { x, y, width, height };
  }

  // Calculate bounding box using effective dimensions
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const effectiveBoundsMap = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >();
  for (const node of selectedNodes) {
    const bounds = getEffectiveBounds(node);
    effectiveBoundsMap.set(node.id, bounds);
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  }

  // Create group with children at relative positions
  // Use effective positions for offset calculation
  const groupId = generateId();
  const groupNode: GroupNode = {
    id: groupId,
    type: "group",
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    children: selectedNodes.map((node) => {
      const bounds = effectiveBoundsMap.get(node.id)!;
      return {
        ...node,
        x: bounds.x - minX,
        y: bounds.y - minY,
        // Persist the effective dimensions so they match the visual size
        width: bounds.width,
        height: bounds.height,
      } as SceneNode;
    }),
  };

  // Find the insertion index (smallest index among selected nodes)
  const insertIndex = Math.min(...validPositions.map((p) => p.index));

  // Remove selected nodes and insert group
  const idSet = new Set(ids);

  const processedNodes = processTreeAtLevel(nodes, parentId, (levelNodes) => {
    // This is the target level - remove selected nodes and insert group
    const filtered = levelNodes.filter((n) => !idSet.has(n.id));
    const adjustedIndex = Math.min(insertIndex, filtered.length);
    filtered.splice(adjustedIndex, 0, groupNode);
    return filtered;
  });

  return { nodes: processedNodes, groupId };
}

// Ungroup a group node, placing its children back at the group's level
function ungroupNodeInTree(
  nodes: SceneNode[],
  groupId: string,
): SceneNode[] | null {
  const pos = findNodePosition(nodes, groupId);
  if (!pos) return null;

  const groupNode = findNodeInTree(nodes, groupId);
  if (!groupNode || groupNode.type !== "group") return null;

  const group = groupNode as GroupNode;

  // Adjust children positions to be absolute (relative to the group's parent)
  const absoluteChildren = group.children.map(
    (child) =>
      ({
        ...child,
        x: child.x + group.x,
        y: child.y + group.y,
      } as SceneNode),
  );

  return processTreeAtLevel(nodes, pos.parentId, (levelNodes) => {
    // Replace group with its children
    const result: SceneNode[] = [];
    for (const node of levelNodes) {
      if (node.id === groupId) {
        result.push(...absoluteChildren);
      } else {
        result.push(node);
      }
    }
    return result;
  });
}

// Convert a group node to frame or a non-reusable frame to group
function convertNodeInTree(
  nodes: SceneNode[],
  targetId: string,
): SceneNode[] | null {
  const node = findNodeInTree(nodes, targetId);
  if (!node) return null;

  if (node.type === "group") {
    // Group → Frame: keep all base props + children, set type to frame
    const group = node as GroupNode;
    const frame: FrameNode = {
      id: group.id,
      type: "frame",
      name: group.name,
      x: group.x,
      y: group.y,
      width: group.width,
      height: group.height,
      fill: group.fill,
      stroke: group.stroke,
      strokeWidth: group.strokeWidth,
      visible: group.visible,
      enabled: group.enabled,
      sizing: group.sizing,
      fillBinding: group.fillBinding,
      strokeBinding: group.strokeBinding,
      rotation: group.rotation,
      opacity: group.opacity,
      fillOpacity: group.fillOpacity,
      strokeOpacity: group.strokeOpacity,
      flipX: group.flipX,
      flipY: group.flipY,
      imageFill: group.imageFill,
      children: group.children,
    };
    return replaceNodeInTree(nodes, targetId, frame);
  }

  if (node.type === "frame") {
    const frame = node as FrameNode;
    // Block conversion of reusable frames (components)
    if (frame.reusable) return null;

    const group: GroupNode = {
      id: frame.id,
      type: "group",
      name: frame.name,
      x: frame.x,
      y: frame.y,
      width: frame.width,
      height: frame.height,
      fill: frame.fill,
      stroke: frame.stroke,
      strokeWidth: frame.strokeWidth,
      visible: frame.visible,
      enabled: frame.enabled,
      sizing: frame.sizing,
      fillBinding: frame.fillBinding,
      strokeBinding: frame.strokeBinding,
      rotation: frame.rotation,
      opacity: frame.opacity,
      fillOpacity: frame.fillOpacity,
      strokeOpacity: frame.strokeOpacity,
      flipX: frame.flipX,
      flipY: frame.flipY,
      imageFill: frame.imageFill,
      children: frame.children,
    };
    return replaceNodeInTree(nodes, targetId, group);
  }

  return null;
}

// Replace a node in tree by ID
function replaceNodeInTree(
  nodes: SceneNode[],
  targetId: string,
  replacement: SceneNode,
): SceneNode[] {
  return nodes.map((node) => {
    if (node.id === targetId) return replacement;
    if (isContainerNode(node)) {
      return {
        ...node,
        children: replaceNodeInTree(node.children, targetId, replacement),
      } as FrameNode | GroupNode;
    }
    return node;
  });
}

export const useSceneStore = create<SceneState>((set) => ({
  nodes: [],
  nodesById: {},
  parentById: {},
  indexById: {},
  childrenById: {},
  rootIds: [],
  expandedFrameIds: new Set<string>(),
  pageBackground: "#f5f5f5",

  addNode: (node) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const synced = node.type === "text" ? syncTextDimensions(node) : node;
      const nextNodes = [...state.nodes, synced];
      return { ...withRebuiltIndex(nextNodes) };
    }),

  addChildToFrame: (frameId, child) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const parent = state.nodesById[frameId];
      if (!parent || !isContainerNode(parent)) {
        const nextNodes = addChildToFrameRecursive(state.nodes, frameId, child);
        return { ...withRebuiltIndex(nextNodes) };
      }

      const newChildIndex = parent.children.length;
      const updatedParent = {
        ...parent,
        children: [...parent.children, child],
      } as FrameNode | GroupNode;

      const replaced = replaceNodeInTreeByIndex(
        state.nodes,
        state.nodesById,
        state.parentById,
        state.indexById,
        frameId,
        updatedParent,
      );

      const nodesById = replaced.nodesById;
      const parentById = { ...state.parentById };
      const indexById = { ...state.indexById };
      const childrenById = { ...state.childrenById };
      const rootIds = state.rootIds;

      const childIds = updatedParent.children.map((c) => c.id);
      childrenById[frameId] = childIds;
      updateIndicesForList(childIds, indexById, newChildIndex);
      addSubtreeToIndex(
        child,
        frameId,
        newChildIndex,
        nodesById,
        parentById,
        indexById,
        childrenById,
      );

      return {
        nodes: replaced.nodes,
        nodesById,
        parentById,
        indexById,
        childrenById,
        rootIds,
      };
    }),

  updateNode: (id, updates) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const existing = state.nodesById[id];
      if (!existing) {
        const nextNodes = updateNodeRecursive(state.nodes, id, updates).nodes;
        return { ...withRebuiltIndex(nextNodes) };
      }
      let updated = { ...existing, ...updates } as SceneNode;
      if (updated.type === "text" && hasTextMeasureProps(updates)) {
        updated = syncTextDimensions(updated);
      }
      const replaced = replaceNodeInTreeByIndex(
        state.nodes,
        state.nodesById,
        state.parentById,
        state.indexById,
        id,
        updated,
      );
      return {
        nodes: replaced.nodes,
        nodesById: replaced.nodesById,
        parentById: state.parentById,
        indexById: state.indexById,
        childrenById: state.childrenById,
        rootIds: state.rootIds,
      };
    }),

  updateNodeWithoutHistory: (id, updates) =>
    set((state) => {
      const existing = state.nodesById[id];
      if (!existing) {
        const nextNodes = updateNodeRecursive(state.nodes, id, updates).nodes;
        return { ...withRebuiltIndex(nextNodes) };
      }
      let updated = { ...existing, ...updates } as SceneNode;
      if (updated.type === "text" && hasTextMeasureProps(updates)) {
        updated = syncTextDimensions(updated);
      }
      const replaced = replaceNodeInTreeByIndex(
        state.nodes,
        state.nodesById,
        state.parentById,
        state.indexById,
        id,
        updated,
      );
      return {
        nodes: replaced.nodes,
        nodesById: replaced.nodesById,
        parentById: state.parentById,
        indexById: state.indexById,
        childrenById: state.childrenById,
        rootIds: state.rootIds,
      };
    }),

  deleteNode: (id) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const existing = state.nodesById[id];
      if (!existing) {
        const nextNodes = deleteNodeRecursive(state.nodes, id);
        return { ...withRebuiltIndex(nextNodes) };
      }

      const parentById = { ...state.parentById };
      const indexById = { ...state.indexById };
      const childrenById = { ...state.childrenById };
      const nodesById = { ...state.nodesById };
      let rootIds = state.rootIds.slice();
      let nextNodes = state.nodes;

      const parentId = parentById[id];
      const removeIndex = indexById[id];

      if (parentId === null) {
        const updatedNodes = state.nodes.slice();
        updatedNodes.splice(removeIndex, 1);
        nextNodes = updatedNodes;
        rootIds.splice(removeIndex, 1);
        updateIndicesForList(rootIds, indexById, removeIndex);
      } else {
        const parent = nodesById[parentId] as FrameNode | GroupNode;
        const nextChildren = parent.children.slice();
        nextChildren.splice(removeIndex, 1);
        const updatedParent = { ...parent, children: nextChildren } as
          | FrameNode
          | GroupNode;

        const replaced = replaceNodeInTreeByIndex(
          state.nodes,
          nodesById,
          parentById,
          indexById,
          parentId,
          updatedParent,
        );
        nextNodes = replaced.nodes;
        Object.assign(nodesById, replaced.nodesById);
        const childIds = nextChildren.map((c) => c.id);
        childrenById[parentId] = childIds;
        updateIndicesForList(childIds, indexById, removeIndex);
      }

      removeSubtreeFromIndex(id, nodesById, parentById, indexById, childrenById);

      return {
        nodes: nextNodes,
        nodesById,
        parentById,
        indexById,
        childrenById,
        rootIds,
      };
    }),

  clearNodes: () => set({ ...withRebuiltIndex([]) }),

  setNodes: (nodes) => {
    useHistoryStore.getState().saveHistory(useSceneStore.getState().nodes);
    // Sync text dimensions on load to fix any stale width/height
    set({ ...withRebuiltIndex(syncAllTextDimensions(nodes)) });
    // Auto-load any Google Fonts used in the scene
    // (the global fontLoadCallback will re-sync dimensions after each font loads)
    loadGoogleFontsFromNodes(nodes);
  },

  // Set nodes without saving to history (used by undo/redo)
  setNodesWithoutHistory: (nodes) => set({ ...withRebuiltIndex(nodes) }),

  reorderNode: (fromIndex, toIndex) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const newNodes = [...state.nodes];
      const [removed] = newNodes.splice(fromIndex, 1);
      newNodes.splice(toIndex, 0, removed);
      return { ...withRebuiltIndex(newNodes) };
    }),

  setVisibility: (id, visible) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const nextNodes = setVisibilityRecursive(state.nodes, id, visible);
      return { ...withRebuiltIndex(nextNodes) };
    }),

  toggleVisibility: (id) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const nextNodes = toggleVisibilityRecursive(state.nodes, id);
      return { ...withRebuiltIndex(nextNodes) };
    }),

  toggleFrameExpanded: (id) =>
    set((state) => {
      const newSet = new Set(state.expandedFrameIds);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return { expandedFrameIds: newSet };
    }),

  setFrameExpanded: (id, expanded) =>
    set((state) => {
      const newSet = new Set(state.expandedFrameIds);
      if (expanded) {
        newSet.add(id);
      } else {
        newSet.delete(id);
      }
      return { expandedFrameIds: newSet };
    }),

  moveNode: (nodeId, newParentId, newIndex) =>
    set((state) => {
      const node = state.nodesById[nodeId];
      if (!node) return state;

      useHistoryStore.getState().saveHistory(state.nodes);

      const parentById = { ...state.parentById };
      const indexById = { ...state.indexById };
      const childrenById = { ...state.childrenById };
      const nodesById = { ...state.nodesById };
      let rootIds = state.rootIds.slice();
      let nextNodes = state.nodes;

      const oldParentId = parentById[nodeId];
      const oldIndex = indexById[nodeId];

      // Remove from old location
      if (oldParentId === null) {
        const updatedNodes = nextNodes.slice();
        updatedNodes.splice(oldIndex, 1);
        nextNodes = updatedNodes;
        rootIds.splice(oldIndex, 1);
        updateIndicesForList(rootIds, indexById, oldIndex);
      } else {
        const oldParent = nodesById[oldParentId] as FrameNode | GroupNode;
        const nextChildren = oldParent.children.slice();
        nextChildren.splice(oldIndex, 1);
        const updatedParent = { ...oldParent, children: nextChildren } as
          | FrameNode
          | GroupNode;
        const replaced = replaceNodeInTreeByIndex(
          nextNodes,
          nodesById,
          parentById,
          indexById,
          oldParentId,
          updatedParent,
        );
        nextNodes = replaced.nodes;
        Object.assign(nodesById, replaced.nodesById);
        const childIds = nextChildren.map((c) => c.id);
        childrenById[oldParentId] = childIds;
        updateIndicesForList(childIds, indexById, oldIndex);
      }

      // Insert into new location
      if (newParentId === null) {
        const updatedNodes = nextNodes.slice();
        updatedNodes.splice(newIndex, 0, node);
        nextNodes = updatedNodes;
        rootIds.splice(newIndex, 0, node.id);
        updateIndicesForList(rootIds, indexById, newIndex);
        addSubtreeToIndex(
          node,
          null,
          newIndex,
          nodesById,
          parentById,
          indexById,
          childrenById,
        );
      } else {
        const newParent = nodesById[newParentId];
        if (!newParent || !isContainerNode(newParent)) {
          const newNodes = insertNodeRecursive(
            nextNodes,
            node,
            newParentId,
            newIndex,
          );
          return { ...withRebuiltIndex(newNodes) };
        }

        const nextChildren = newParent.children.slice();
        nextChildren.splice(newIndex, 0, node);
        const updatedParent = { ...newParent, children: nextChildren } as
          | FrameNode
          | GroupNode;
        const replaced = replaceNodeInTreeByIndex(
          nextNodes,
          nodesById,
          parentById,
          indexById,
          newParentId,
          updatedParent,
        );
        nextNodes = replaced.nodes;
        Object.assign(nodesById, replaced.nodesById);
        const childIds = nextChildren.map((c) => c.id);
        childrenById[newParentId] = childIds;
        updateIndicesForList(childIds, indexById, newIndex);
        addSubtreeToIndex(
          node,
          newParentId,
          newIndex,
          nodesById,
          parentById,
          indexById,
          childrenById,
        );
      }

      return {
        nodes: nextNodes,
        nodesById,
        parentById,
        indexById,
        childrenById,
        rootIds,
      };
    }),

  updateDescendantOverride: (instanceId, descendantId, updates) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const nextNodes = updateDescendantOverrideRecursive(
        state.nodes,
        instanceId,
        descendantId,
        updates,
      );
      return { ...withRebuiltIndex(nextNodes) };
    }),

  resetDescendantOverride: (instanceId, descendantId, property) =>
    set((state) => {
      useHistoryStore.getState().saveHistory(state.nodes);
      const nextNodes = resetDescendantOverrideRecursive(
        state.nodes,
        instanceId,
        descendantId,
        property,
      );
      return { ...withRebuiltIndex(nextNodes) };
    }),

  groupNodes: (ids) => {
    const state = useSceneStore.getState();
    const calculateLayoutForFrame =
      useLayoutStore.getState().calculateLayoutForFrame;
    const result = groupNodesInTree(state.nodes, ids, calculateLayoutForFrame);
    if (!result) return null;
    useHistoryStore.getState().saveHistory(state.nodes);
    useSceneStore.setState({ ...withRebuiltIndex(result.nodes) });
    return result.groupId;
  },

  ungroupNodes: (ids) => {
    const state = useSceneStore.getState();
    let currentNodes = state.nodes;
    const childIds: string[] = [];

    useHistoryStore.getState().saveHistory(state.nodes);
    for (const id of ids) {
      const node = findNodeInTree(currentNodes, id);
      if (node && node.type === "group") {
        const group = node as GroupNode;
        childIds.push(...group.children.map((c) => c.id));
        const result = ungroupNodeInTree(currentNodes, id);
        if (result) {
          currentNodes = result;
        }
      }
    }
    useSceneStore.setState({ ...withRebuiltIndex(currentNodes) });
    return childIds;
  },

  convertNodeType: (id) => {
    const state = useSceneStore.getState();
    const result = convertNodeInTree(state.nodes, id);
    if (!result) return false;
    useHistoryStore.getState().saveHistory(state.nodes);
    useSceneStore.setState({ ...withRebuiltIndex(result) });
    return true;
  },

  setPageBackground: (color) =>
    set(() => {
      return { pageBackground: color };
    }),
}));

// Re-sync text dimensions whenever a Google Font finishes loading
registerFontLoadCallback(() => {
  const state = useSceneStore.getState();
  const synced = syncAllTextDimensions(state.nodes);
  useSceneStore.setState({ ...withRebuiltIndex(synced) });
});
