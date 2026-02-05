import { create } from "zustand";
import type {
  SceneNode,
  FrameNode,
  RefNode,
  TextNode,
  FlatSceneNode,
  FlatFrameNode,
  FlatSnapshot,
  DescendantOverride,
} from "../types/scene";
import {
  isContainerNode,
  generateId,
  toFlatNode,
  flattenTree,
  buildTree,
  collectDescendantIds,
} from "../types/scene";
import { useHistoryStore } from "./historyStore";
import { useLayoutStore } from "./layoutStore";
import {
  measureTextAutoSize,
  measureTextFixedWidthHeight,
} from "../utils/textMeasure";
import { loadGoogleFontsFromNodes, registerFontLoadCallback } from "../utils/fontUtils";
import { calculateFrameIntrinsicSize } from "../utils/yogaLayout";

// ----- Types -----

export interface SceneState {
  // Primary flat storage
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];

  // Backward compat: lazily cached tree
  _cachedTree: SceneNode[] | null;

  // UI state
  expandedFrameIds: Set<string>;
  pageBackground: string;

  // Get full tree (lazy, cached)
  getNodes: () => SceneNode[];

  // Mutations
  addNode: (node: SceneNode) => void;
  addChildToFrame: (frameId: string, child: SceneNode) => void;
  updateNode: (id: string, updates: Partial<SceneNode>) => void;
  updateNodeWithoutHistory: (id: string, updates: Partial<SceneNode>) => void;
  deleteNode: (id: string) => void;
  clearNodes: () => void;
  setNodes: (nodes: SceneNode[]) => void;
  setNodesWithoutHistory: (nodes: SceneNode[]) => void;
  restoreSnapshot: (snapshot: FlatSnapshot) => void;
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
  groupNodes: (ids: string[]) => string | null;
  ungroupNodes: (ids: string[]) => string[];
  convertNodeType: (id: string) => boolean;
  wrapInAutoLayoutFrame: (ids: string[]) => string | null;
  setPageBackground: (color: string) => void;
}

// ----- Helpers -----

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

function syncTextDimensions(node: FlatSceneNode): FlatSceneNode {
  if (node.type !== "text") return node;
  const textNode = node as TextNode;
  const mode = textNode.textWidthMode;

  if (!mode || mode === "auto") {
    const measured = measureTextAutoSize(textNode);
    return { ...textNode, width: measured.width, height: measured.height };
  } else if (mode === "fixed") {
    const measuredHeight = measureTextFixedWidthHeight(textNode);
    return { ...textNode, height: measuredHeight };
  }
  return textNode;
}

function hasTextMeasureProps(updates: Partial<SceneNode>): boolean {
  return Object.keys(updates).some((k) => TEXT_MEASURE_PROPS.has(k));
}

/** Sync text dimensions for all text nodes in the flat store */
function syncAllTextDimensionsFlat(
  nodesById: Record<string, FlatSceneNode>,
): Record<string, FlatSceneNode> {
  let changed = false;
  const result = { ...nodesById };
  for (const [id, node] of Object.entries(result)) {
    if (node.type === "text") {
      const synced = syncTextDimensions(node);
      if (synced !== node) {
        result[id] = synced;
        changed = true;
      }
    }
  }
  return changed ? result : nodesById;
}

/** Insert a node and all its descendants into the flat store */
function insertTreeIntoFlat(
  node: SceneNode,
  parentId: string | null,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
): void {
  nodesById[node.id] = toFlatNode(node);
  parentById[node.id] = parentId;
  if (isContainerNode(node)) {
    childrenById[node.id] = node.children.map((c) => c.id);
    for (const child of node.children) {
      insertTreeIntoFlat(child, node.id, nodesById, parentById, childrenById);
    }
  }
}

/** Remove a node and all its descendants from the flat store */
function removeNodeAndDescendants(
  nodeId: string,
  nodesById: Record<string, FlatSceneNode>,
  parentById: Record<string, string | null>,
  childrenById: Record<string, string[]>,
): void {
  const toDelete = collectDescendantIds(nodeId, childrenById);
  toDelete.push(nodeId);
  for (const id of toDelete) {
    delete nodesById[id];
    delete parentById[id];
    delete childrenById[id];
  }
}

/** Create a history snapshot (shallow clone - node refs are immutable) */
export function createSnapshot(state: {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null>;
  childrenById: Record<string, string[]>;
  rootIds: string[];
}): FlatSnapshot {
  return {
    nodesById: { ...state.nodesById },
    parentById: { ...state.parentById },
    childrenById: { ...state.childrenById },
    rootIds: [...state.rootIds],
  };
}

/** Save current state to history */
function saveHistory(state: SceneState) {
  useHistoryStore.getState().saveHistory(createSnapshot(state));
}

// ----- Module-level tree cache (avoids setState in selectors) -----
let _treeCacheRef: {
  nodesById: Record<string, FlatSceneNode>;
  rootIds: string[];
  childrenById: Record<string, string[]>;
  tree: SceneNode[];
} | null = null;

function getCachedTree(state: {
  nodesById: Record<string, FlatSceneNode>;
  rootIds: string[];
  childrenById: Record<string, string[]>;
}): SceneNode[] {
  if (
    _treeCacheRef &&
    _treeCacheRef.nodesById === state.nodesById &&
    _treeCacheRef.rootIds === state.rootIds &&
    _treeCacheRef.childrenById === state.childrenById
  ) {
    return _treeCacheRef.tree;
  }
  const tree = buildTree(state.rootIds, state.nodesById, state.childrenById);
  _treeCacheRef = {
    nodesById: state.nodesById,
    rootIds: state.rootIds,
    childrenById: state.childrenById,
    tree,
  };
  return tree;
}

// ----- Store -----

export const useSceneStore = create<SceneState>((set, get) => ({
  nodesById: {},
  parentById: {},
  childrenById: {},
  rootIds: [],
  _cachedTree: null,
  expandedFrameIds: new Set<string>(),
  pageBackground: "#f5f5f5",

  // Lazy tree builder for backward compat
  getNodes: () => getCachedTree(get()),

  // ----- Mutations -----

  addNode: (node) =>
    set((state) => {
      saveHistory(state);
      const synced = node.type === "text" ? syncTextDimensions(toFlatNode(node)) : toFlatNode(node);
      const newNodesById = { ...state.nodesById, [node.id]: synced };
      const newParentById = { ...state.parentById, [node.id]: null };
      const newChildrenById = { ...state.childrenById };
      const newRootIds = [...state.rootIds, node.id];

      // If node is a container with children, insert descendants
      if (isContainerNode(node) && node.children.length > 0) {
        newChildrenById[node.id] = node.children.map((c) => c.id);
        for (const child of node.children) {
          insertTreeIntoFlat(child, node.id, newNodesById, newParentById, newChildrenById);
        }
      }

      return {
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      };
    }),

  addChildToFrame: (frameId, child) =>
    set((state) => {
      saveHistory(state);
      const newNodesById = { ...state.nodesById };
      const newParentById = { ...state.parentById };
      const newChildrenById = { ...state.childrenById };

      // Insert the child (and its subtree) into flat storage
      insertTreeIntoFlat(child, frameId, newNodesById, newParentById, newChildrenById);

      // Update parent's children list
      const existingChildren = newChildrenById[frameId] ?? [];
      newChildrenById[frameId] = [...existingChildren, child.id];

      return {
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        _cachedTree: null,
      };
    }),

  updateNode: (id, updates) =>
    set((state) => {
      const existing = state.nodesById[id];
      if (!existing) return state;
      saveHistory(state);

      let updated = { ...existing, ...updates } as FlatSceneNode;
      if (updated.type === "text" && hasTextMeasureProps(updates)) {
        updated = syncTextDimensions(updated);
      }

      return {
        nodesById: { ...state.nodesById, [id]: updated },
        _cachedTree: null,
      };
    }),

  updateNodeWithoutHistory: (id, updates) =>
    set((state) => {
      const existing = state.nodesById[id];
      if (!existing) return state;

      let updated = { ...existing, ...updates } as FlatSceneNode;
      if (updated.type === "text" && hasTextMeasureProps(updates)) {
        updated = syncTextDimensions(updated);
      }

      return {
        nodesById: { ...state.nodesById, [id]: updated },
        _cachedTree: null,
      };
    }),

  deleteNode: (id) =>
    set((state) => {
      if (!state.nodesById[id]) return state;
      saveHistory(state);

      const parentId = state.parentById[id];
      const newNodesById = { ...state.nodesById };
      const newParentById = { ...state.parentById };
      const newChildrenById = { ...state.childrenById };

      // Remove from parent's children list
      if (parentId !== null && parentId !== undefined) {
        newChildrenById[parentId] = (newChildrenById[parentId] ?? []).filter(
          (cid) => cid !== id,
        );
      }

      // Remove node and all descendants
      removeNodeAndDescendants(id, newNodesById, newParentById, newChildrenById);

      // Update rootIds if root node
      const newRootIds = parentId === null || parentId === undefined
        ? state.rootIds.filter((rid) => rid !== id)
        : state.rootIds;

      return {
        nodesById: newNodesById,
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      };
    }),

  clearNodes: () =>
    set({
      nodesById: {},
      parentById: {},
      childrenById: {},
      rootIds: [],
      _cachedTree: null,
    }),

  setNodes: (nodes) => {
    const state = get();
    saveHistory(state);
    const flat = flattenTree(nodes);
    const synced = syncAllTextDimensionsFlat(flat.nodesById);
    set({
      nodesById: synced,
      parentById: flat.parentById,
      childrenById: flat.childrenById,
      rootIds: flat.rootIds,
      _cachedTree: null,
    });
    loadGoogleFontsFromNodes(nodes);
  },

  setNodesWithoutHistory: (nodes) => {
    const flat = flattenTree(nodes);
    set({
      nodesById: flat.nodesById,
      parentById: flat.parentById,
      childrenById: flat.childrenById,
      rootIds: flat.rootIds,
      _cachedTree: null,
    });
  },

  restoreSnapshot: (snapshot) => {
    set({
      nodesById: snapshot.nodesById,
      parentById: snapshot.parentById,
      childrenById: snapshot.childrenById,
      rootIds: snapshot.rootIds,
      _cachedTree: null,
    });
  },

  reorderNode: (fromIndex, toIndex) =>
    set((state) => {
      saveHistory(state);
      const newRootIds = [...state.rootIds];
      const [removed] = newRootIds.splice(fromIndex, 1);
      newRootIds.splice(toIndex, 0, removed);
      return { rootIds: newRootIds, _cachedTree: null };
    }),

  setVisibility: (id, visible) =>
    set((state) => {
      const existing = state.nodesById[id];
      if (!existing) return state;
      saveHistory(state);
      return {
        nodesById: { ...state.nodesById, [id]: { ...existing, visible } },
        _cachedTree: null,
      };
    }),

  toggleVisibility: (id) =>
    set((state) => {
      const existing = state.nodesById[id];
      if (!existing) return state;
      saveHistory(state);
      return {
        nodesById: {
          ...state.nodesById,
          [id]: { ...existing, visible: existing.visible === false ? true : false },
        },
        _cachedTree: null,
      };
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

      const oldParentId = state.parentById[nodeId];
      saveHistory(state);

      const newParentById = { ...state.parentById, [nodeId]: newParentId };
      const newChildrenById = { ...state.childrenById };
      let newRootIds = [...state.rootIds];

      // Remove from old parent
      if (oldParentId !== null && oldParentId !== undefined) {
        newChildrenById[oldParentId] = (newChildrenById[oldParentId] ?? []).filter(
          (cid) => cid !== nodeId,
        );
      } else {
        newRootIds = newRootIds.filter((rid) => rid !== nodeId);
      }

      // Insert into new parent
      if (newParentId !== null) {
        const siblings = [...(newChildrenById[newParentId] ?? [])];
        siblings.splice(newIndex, 0, nodeId);
        newChildrenById[newParentId] = siblings;
      } else {
        newRootIds.splice(newIndex, 0, nodeId);
      }

      return {
        parentById: newParentById,
        childrenById: newChildrenById,
        rootIds: newRootIds,
        _cachedTree: null,
      };
    }),

  updateDescendantOverride: (instanceId, descendantId, updates) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;
      saveHistory(state);

      const refNode = existing as RefNode;
      const existingOverrides = refNode.descendants || {};
      const existingDescendant = existingOverrides[descendantId] || {};

      const updated: RefNode = {
        ...refNode,
        descendants: {
          ...existingOverrides,
          [descendantId]: { ...existingDescendant, ...updates },
        },
      };

      return {
        nodesById: { ...state.nodesById, [instanceId]: updated },
        _cachedTree: null,
      };
    }),

  resetDescendantOverride: (instanceId, descendantId, property) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;

      const refNode = existing as RefNode;
      const existingOverrides = refNode.descendants || {};
      if (!existingOverrides[descendantId]) return state;

      saveHistory(state);

      let updated: RefNode;
      if (property) {
        const { [property]: _, ...remainingProps } = existingOverrides[descendantId];
        if (Object.keys(remainingProps).length === 0) {
          const { [descendantId]: __, ...remainingOverrides } = existingOverrides;
          updated = {
            ...refNode,
            descendants:
              Object.keys(remainingOverrides).length > 0
                ? remainingOverrides
                : undefined,
          };
        } else {
          updated = {
            ...refNode,
            descendants: {
              ...existingOverrides,
              [descendantId]: remainingProps,
            },
          };
        }
      } else {
        const { [descendantId]: _, ...remainingOverrides } = existingOverrides;
        updated = {
          ...refNode,
          descendants:
            Object.keys(remainingOverrides).length > 0
              ? remainingOverrides
              : undefined,
        };
      }

      return {
        nodesById: { ...state.nodesById, [instanceId]: updated },
        _cachedTree: null,
      };
    }),

  groupNodes: (ids) => {
    const state = get();
    if (ids.length < 2) return null;

    const calculateLayoutForFrame =
      useLayoutStore.getState().calculateLayoutForFrame;

    // All nodes must share the same parent
    const parentId = state.parentById[ids[0]];
    if (!ids.every((id) => state.parentById[id] === parentId)) return null;

    // Get the actual nodes
    const selectedNodes = ids.map((id) => state.nodesById[id]).filter(Boolean);
    if (selectedNodes.length !== ids.length) return null;

    // If parent is an auto-layout frame, use Yoga-computed positions
    let layoutMap = new Map<string, { x: number; y: number; width: number; height: number }>();
    if (parentId) {
      const parentNode = state.nodesById[parentId];
      if (
        parentNode &&
        parentNode.type === "frame" &&
        (parentNode as FlatFrameNode).layout?.autoLayout
      ) {
        // Build a temporary tree node for Yoga calculation
        const parentTree = buildTree([parentId], state.nodesById, state.childrenById)[0] as FrameNode;
        const layoutNodes = calculateLayoutForFrame(parentTree);
        for (const ln of layoutNodes) {
          layoutMap.set(ln.id, { x: ln.x, y: ln.y, width: ln.width, height: ln.height });
        }
      }
    }

    // Get effective bounds for each node
    function getEffectiveBounds(node: FlatSceneNode): { x: number; y: number; width: number; height: number } {
      const layoutNode = layoutMap.get(node.id);
      const x = layoutNode?.x ?? node.x;
      const y = layoutNode?.y ?? node.y;
      let width = layoutNode?.width ?? node.width;
      let height = layoutNode?.height ?? node.height;

      if (node.type === "frame") {
        const frame = node as FlatFrameNode;
        if (frame.layout?.autoLayout) {
          const fitWidth = frame.sizing?.widthMode === "fit_content";
          const fitHeight = frame.sizing?.heightMode === "fit_content";
          if (fitWidth || fitHeight) {
            const frameTree = buildTree([node.id], state.nodesById, state.childrenById)[0] as FrameNode;
            const intrinsic = calculateFrameIntrinsicSize(frameTree, { fitWidth, fitHeight });
            if (fitWidth) width = intrinsic.width;
            if (fitHeight) height = intrinsic.height;
          }
        }
      }

      return { x, y, width, height };
    }

    // Calculate bounding box
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const boundsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of selectedNodes) {
      const bounds = getEffectiveBounds(node);
      boundsMap.set(node.id, bounds);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }

    saveHistory(state);

    const groupId = generateId();
    const groupNode: FlatSceneNode = {
      id: groupId,
      type: "group" as const,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };

    // Find insertion index in parent's children
    const parentChildren = parentId !== null && parentId !== undefined
      ? (state.childrenById[parentId] ?? [])
      : state.rootIds;
    const insertIndex = Math.min(
      ...ids.map((id) => parentChildren.indexOf(id)).filter((i) => i >= 0),
    );

    // Build new state
    const newNodesById = { ...state.nodesById, [groupId]: groupNode };
    const newParentById = { ...state.parentById, [groupId]: parentId };
    const newChildrenById = { ...state.childrenById };
    const idSet = new Set(ids);

    // Update each moved node: adjust position relative to group, set parent to group
    for (const id of ids) {
      const bounds = boundsMap.get(id)!;
      const existingNode = newNodesById[id];
      newNodesById[id] = { ...existingNode, x: bounds.x - minX, y: bounds.y - minY, width: bounds.width, height: bounds.height } as FlatSceneNode;
      newParentById[id] = groupId;
    }

    // Set group's children
    newChildrenById[groupId] = ids;

    // Update parent's children: remove grouped nodes, insert group
    let newRootIds = state.rootIds;
    if (parentId !== null && parentId !== undefined) {
      const filtered = (state.childrenById[parentId] ?? []).filter((cid) => !idSet.has(cid));
      filtered.splice(Math.min(insertIndex, filtered.length), 0, groupId);
      newChildrenById[parentId] = filtered;
    } else {
      const filtered = state.rootIds.filter((rid) => !idSet.has(rid));
      filtered.splice(Math.min(insertIndex, filtered.length), 0, groupId);
      newRootIds = filtered;
    }

    useSceneStore.setState({
      nodesById: newNodesById,
      parentById: newParentById,
      childrenById: newChildrenById,
      rootIds: newRootIds,
      _cachedTree: null,
    });
    return groupId;
  },

  ungroupNodes: (ids) => {
    const state = get();
    const childIds: string[] = [];

    saveHistory(state);

    const newNodesById = { ...state.nodesById };
    const newParentById = { ...state.parentById };
    const newChildrenById = { ...state.childrenById };
    let newRootIds = [...state.rootIds];

    for (const id of ids) {
      const node = state.nodesById[id];
      if (!node || node.type !== "group") continue;
      const group = node;

      const groupParentId = state.parentById[id];
      const groupChildIds = state.childrenById[id] ?? [];

      // Adjust children positions to be absolute
      for (const childId of groupChildIds) {
        const child = newNodesById[childId];
        if (child) {
          newNodesById[childId] = {
            ...child,
            x: child.x + group.x,
            y: child.y + group.y,
          } as FlatSceneNode;
          newParentById[childId] = groupParentId;
          childIds.push(childId);
        }
      }

      // Replace group with its children in parent
      if (groupParentId !== null && groupParentId !== undefined) {
        const parentChildList = newChildrenById[groupParentId] ?? [];
        const idx = parentChildList.indexOf(id);
        if (idx >= 0) {
          const updated = [...parentChildList];
          updated.splice(idx, 1, ...groupChildIds);
          newChildrenById[groupParentId] = updated;
        }
      } else {
        const idx = newRootIds.indexOf(id);
        if (idx >= 0) {
          newRootIds.splice(idx, 1, ...groupChildIds);
        }
      }

      // Remove the group node itself
      delete newNodesById[id];
      delete newParentById[id];
      delete newChildrenById[id];
    }

    useSceneStore.setState({
      nodesById: newNodesById,
      parentById: newParentById,
      childrenById: newChildrenById,
      rootIds: newRootIds,
      _cachedTree: null,
    });
    return childIds;
  },

  convertNodeType: (id) => {
    const state = get();
    const node = state.nodesById[id];
    if (!node) return false;

    saveHistory(state);

    if (node.type === "group") {
      // Group -> Frame
      const frame: FlatSceneNode = {
        id: node.id,
        type: "frame" as const,
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fill: node.fill,
        stroke: node.stroke,
        strokeWidth: node.strokeWidth,
        visible: node.visible,
        enabled: node.enabled,
        sizing: node.sizing,
        fillBinding: node.fillBinding,
        strokeBinding: node.strokeBinding,
        rotation: node.rotation,
        opacity: node.opacity,
        fillOpacity: node.fillOpacity,
        strokeOpacity: node.strokeOpacity,
        flipX: node.flipX,
        flipY: node.flipY,
        imageFill: node.imageFill,
      };
      useSceneStore.setState({
        nodesById: { ...state.nodesById, [id]: frame },
        _cachedTree: null,
      });
      return true;
    }

    if (node.type === "frame") {
      const frame = node as FlatFrameNode;
      if (frame.reusable) return false;

      const group: FlatSceneNode = {
        id: node.id,
        type: "group" as const,
        name: node.name,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
        fill: node.fill,
        stroke: node.stroke,
        strokeWidth: node.strokeWidth,
        visible: node.visible,
        enabled: node.enabled,
        sizing: node.sizing,
        fillBinding: node.fillBinding,
        strokeBinding: node.strokeBinding,
        rotation: node.rotation,
        opacity: node.opacity,
        fillOpacity: node.fillOpacity,
        strokeOpacity: node.strokeOpacity,
        flipX: node.flipX,
        flipY: node.flipY,
        imageFill: node.imageFill,
      };
      useSceneStore.setState({
        nodesById: { ...state.nodesById, [id]: group },
        _cachedTree: null,
      });
      return true;
    }

    return false;
  },

  wrapInAutoLayoutFrame: (ids) => {
    const state = get();
    if (ids.length < 1) return null;

    const calculateLayoutForFrame =
      useLayoutStore.getState().calculateLayoutForFrame;

    // All nodes must share the same parent
    const parentId = state.parentById[ids[0]];
    if (!ids.every((id) => state.parentById[id] === parentId)) return null;

    const selectedNodes = ids.map((id) => state.nodesById[id]).filter(Boolean);
    if (selectedNodes.length !== ids.length) return null;

    // If parent is an auto-layout frame, use Yoga-computed positions
    let layoutMap = new Map<string, { x: number; y: number; width: number; height: number }>();
    if (parentId) {
      const parentNode = state.nodesById[parentId];
      if (
        parentNode &&
        parentNode.type === "frame" &&
        (parentNode as FlatFrameNode).layout?.autoLayout
      ) {
        const parentTree = buildTree([parentId], state.nodesById, state.childrenById)[0] as FrameNode;
        const layoutNodes = calculateLayoutForFrame(parentTree);
        for (const ln of layoutNodes) {
          layoutMap.set(ln.id, { x: ln.x, y: ln.y, width: ln.width, height: ln.height });
        }
      }
    }

    function getEffectiveBounds(node: FlatSceneNode): { x: number; y: number; width: number; height: number } {
      const layoutNode = layoutMap.get(node.id);
      const x = layoutNode?.x ?? node.x;
      const y = layoutNode?.y ?? node.y;
      let width = layoutNode?.width ?? node.width;
      let height = layoutNode?.height ?? node.height;

      if (node.type === "frame") {
        const frame = node as FlatFrameNode;
        if (frame.layout?.autoLayout) {
          const fitWidth = frame.sizing?.widthMode === "fit_content";
          const fitHeight = frame.sizing?.heightMode === "fit_content";
          if (fitWidth || fitHeight) {
            const frameTree = buildTree([node.id], state.nodesById, state.childrenById)[0] as FrameNode;
            const intrinsic = calculateFrameIntrinsicSize(frameTree, { fitWidth, fitHeight });
            if (fitWidth) width = intrinsic.width;
            if (fitHeight) height = intrinsic.height;
          }
        }
      }

      return { x, y, width, height };
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const boundsMap = new Map<string, { x: number; y: number; width: number; height: number }>();
    for (const node of selectedNodes) {
      const bounds = getEffectiveBounds(node);
      boundsMap.set(node.id, bounds);
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }

    saveHistory(state);

    const frameId = generateId();
    const frameNode: FlatSceneNode = {
      id: frameId,
      type: "frame" as const,
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      fill: "#ffffff",
      stroke: "#cccccc",
      strokeWidth: 1,
      layout: {
        autoLayout: true,
        flexDirection: "column",
        gap: 0,
        paddingTop: 0,
        paddingRight: 0,
        paddingBottom: 0,
        paddingLeft: 0,
      },
    };

    // Find insertion index
    const parentChildren = parentId !== null && parentId !== undefined
      ? (state.childrenById[parentId] ?? [])
      : state.rootIds;
    const insertIndex = Math.min(
      ...ids.map((id) => parentChildren.indexOf(id)).filter((i) => i >= 0),
    );

    const newNodesById = { ...state.nodesById, [frameId]: frameNode };
    const newParentById = { ...state.parentById, [frameId]: parentId };
    const newChildrenById = { ...state.childrenById };
    const idSet = new Set(ids);

    // Update each wrapped node
    for (const id of ids) {
      const bounds = boundsMap.get(id)!;
      const existingNode = newNodesById[id];
      newNodesById[id] = { ...existingNode, x: bounds.x - minX, y: bounds.y - minY, width: bounds.width, height: bounds.height } as FlatSceneNode;
      newParentById[id] = frameId;
    }

    newChildrenById[frameId] = ids;

    let newRootIds = state.rootIds;
    if (parentId !== null && parentId !== undefined) {
      const filtered = (state.childrenById[parentId] ?? []).filter((cid) => !idSet.has(cid));
      filtered.splice(Math.min(insertIndex, filtered.length), 0, frameId);
      newChildrenById[parentId] = filtered;
    } else {
      const filtered = state.rootIds.filter((rid) => !idSet.has(rid));
      filtered.splice(Math.min(insertIndex, filtered.length), 0, frameId);
      newRootIds = filtered;
    }

    useSceneStore.setState({
      nodesById: newNodesById,
      parentById: newParentById,
      childrenById: newChildrenById,
      rootIds: newRootIds,
      _cachedTree: null,
    });
    return frameId;
  },

  setPageBackground: (color) =>
    set(() => {
      return { pageBackground: color };
    }),
}));

// Re-sync text dimensions whenever a Google Font finishes loading
registerFontLoadCallback(() => {
  const state = useSceneStore.getState();
  const synced = syncAllTextDimensionsFlat(state.nodesById);
  if (synced !== state.nodesById) {
    useSceneStore.setState({ nodesById: synced, _cachedTree: null });
  }
});
