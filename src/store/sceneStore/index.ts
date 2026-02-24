import { create } from "zustand";
import type {
  FlatSceneNode,
  FlatSnapshot,
  HistorySnapshot,
} from "../../types/scene";
import {
  isContainerNode,
  toFlatNode,
  flattenTree,
} from "../../types/scene";
import { loadGoogleFontsFromNodes, registerFontLoadCallback } from "../../utils/fontUtils";
import { saveHistory } from "./helpers/history";
import { useSelectionStore } from "../selectionStore";
import { getCachedTree } from "./helpers/treeCache";
import {
  syncTextDimensions,
  hasTextMeasureProps,
  syncAllTextDimensionsFlat,
  resyncAllTextNodeDimensionsInStore,
} from "./helpers/textSync";
import {
  insertTreeIntoFlat,
  removeNodeAndDescendants,
  normalizeInsertedNode,
} from "./helpers/flatStoreHelpers";
import { createInstanceOperations } from "./instanceOperations";
import { createComplexOperations } from "./complexOperations";
import type { SceneState } from "./types";

// Re-export types and utilities
export type { SceneState } from "./types";
export { createSnapshot } from "./helpers/history";

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

  // ----- Basic Mutations -----

  addNode: (node) => {
    set((state) => {
      saveHistory(state);
      const raw = node.type === "text" ? syncTextDimensions(toFlatNode(node)) : toFlatNode(node);
      const synced = normalizeInsertedNode(raw, state.nodesById);
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
    });
    loadGoogleFontsFromNodes([node]);
  },

  addChildToFrame: (frameId, child) => {
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
    });
    loadGoogleFontsFromNodes([child]);
  },

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

  updateMultipleNodes: (ids, updates) =>
    set((state) => {
      saveHistory(state);
      const newNodesById = { ...state.nodesById };
      const needsTextSync = hasTextMeasureProps(updates);
      for (const id of ids) {
        const existing = newNodesById[id];
        if (!existing) continue;
        let updated = { ...existing, ...updates } as FlatSceneNode;
        if (updated.type === "text" && needsTextSync) {
          updated = syncTextDimensions(updated);
        }
        newNodesById[id] = updated;
      }
      return { nodesById: newNodesById, _cachedTree: null };
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
    // Re-sync once the browser finishes loading any in-flight fonts
    // (covers custom @font-face fonts, not only Google Fonts).
    if (typeof document !== "undefined" && "fonts" in document) {
      document.fonts.ready.then(() => {
        resyncAllTextNodeDimensionsInStore(
          () => useSceneStore.getState(),
          (state) => useSceneStore.setState(state),
        );
      });
    }
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

  restoreSnapshot: (snapshot: FlatSnapshot | HistorySnapshot) => {
    const validIds = new Set(Object.keys(snapshot.nodesById));
    const historySelection = "selection" in snapshot ? snapshot.selection : null;
    set({
      nodesById: snapshot.nodesById,
      parentById: snapshot.parentById,
      childrenById: snapshot.childrenById,
      rootIds: snapshot.rootIds,
      _cachedTree: null,
    });
    if (!historySelection) return;
    useSelectionStore.setState({
      selectedIds: historySelection.selectedIds.filter((id) => validIds.has(id)),
      instanceContext:
        historySelection.instanceContext &&
        validIds.has(historySelection.instanceContext.instanceId)
          ? historySelection.instanceContext
          : null,
      selectedDescendantIds: [...historySelection.selectedDescendantIds],
      enteredContainerId:
        historySelection.enteredContainerId &&
        validIds.has(historySelection.enteredContainerId)
          ? historySelection.enteredContainerId
          : null,
      lastSelectedId:
        historySelection.lastSelectedId &&
        validIds.has(historySelection.lastSelectedId)
          ? historySelection.lastSelectedId
          : null,
      editingNodeId: null,
      editingMode: null,
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

  expandAncestors: (ids) =>
    set((state) => {
      const allExpanded = ids.every((id) => state.expandedFrameIds.has(id));
      if (allExpanded) return state;
      const newSet = new Set(state.expandedFrameIds);
      for (const id of ids) newSet.add(id);
      return { expandedFrameIds: newSet };
    }),

  collapseAllFrames: () => set({ expandedFrameIds: new Set<string>() }),

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

  // ----- Instance Operations (RefNode) -----
  ...createInstanceOperations(get, set),

  // ----- Complex Operations (Group/Ungroup/Convert/Wrap) -----
  ...createComplexOperations(get, (partial) => set(partial)),

  // ----- Page Background -----
  setPageBackground: (color) =>
    set(() => {
      return { pageBackground: color };
    }),
}));

// ----- Font Loading Side Effects -----

// Re-sync text dimensions whenever a Google Font finishes loading
registerFontLoadCallback(() => {
  resyncAllTextNodeDimensionsInStore(
    () => useSceneStore.getState(),
    (state) => useSceneStore.setState(state),
  );
});

// Re-sync text dimensions for any font load completion in the document
// (custom local/web fonts loaded outside loadGoogleFont()).
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.addEventListener("loadingdone", () => {
    resyncAllTextNodeDimensionsInStore(
      () => useSceneStore.getState(),
      (state) => useSceneStore.setState(state),
    );
  });
}
