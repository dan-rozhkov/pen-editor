import type {
  FlatSceneNode,
  FlatSnapshot,
  HistorySnapshot,
  FlatFrameNode,
  SceneNode,
} from "../../types/scene";
import {
  isContainerNode,
  toFlatNode,
  flattenTree,
  collectDescendantIds,
} from "../../types/scene";
import { loadGoogleFontsFromNodes } from "../../utils/fontUtils";
import { saveHistory } from "./helpers/history";
import { useGuidesStore } from "../guidesStore";
import { useSelectionStore } from "../selectionStore";
import { useVariableStore } from "../variableStore";
import { useTextStyleStore } from "../textStyleStore";
import { useStyleStore } from "../styleStore";
import {
  syncTextDimensions,
  hasTextMeasureProps,
  syncAllTextDimensionsFlat,
  resyncAllTextNodeDimensionsInStore,
} from "./helpers/textSync";
import {
  insertTreeIntoFlat,
  removeNodeAndDescendants,
  removeOrphanedConnectors,
} from "./helpers/flatStoreHelpers";
import { markComponentArtifactsStaleFromNative } from "./componentArtifacts";
import type { SceneState } from "./types";
import type { StoreApi } from "zustand";

type SetState = StoreApi<SceneState>["setState"];
type GetState = StoreApi<SceneState>["getState"];

export function createBasicMutations(set: SetState, get: GetState) {
  return {
    addNode: (node: SceneNode) => {
      set((state) => {
        saveHistory(state);
        const flat = node.type === "text" ? syncTextDimensions(toFlatNode(node)) : toFlatNode(node);
        const newNodesById = { ...state.nodesById, [node.id]: flat };
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
          componentArtifactsById: state.componentArtifactsById,
          _cachedTree: null,
        };
      });
      loadGoogleFontsFromNodes([node]);
    },

    addChildToFrame: (frameId: string, child: SceneNode) => {
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
          componentArtifactsById: state.componentArtifactsById,
          _cachedTree: null,
        };
      });
      loadGoogleFontsFromNodes([child]);
    },

    updateNode: (id: string, updates: Partial<SceneNode>) =>
      set((state) => {
        const existing = state.nodesById[id];
        if (!existing) return state;
        saveHistory(state);

        let updated = { ...existing, ...updates } as FlatSceneNode;
        if (updated.type === "text" && hasTextMeasureProps(updates)) {
          updated = syncTextDimensions(updated);
        }

        const newNodesById = { ...state.nodesById, [id]: updated };
        const componentArtifactsById = markComponentArtifactsStaleFromNative(
          state.componentArtifactsById,
          [existing],
        );

        return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
      }),

    updateMultipleNodes: (ids: string[], updates: Partial<SceneNode>) =>
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
        const componentArtifactsById = markComponentArtifactsStaleFromNative(
          state.componentArtifactsById,
          ids.map((id) => state.nodesById[id]),
        );

        return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
      }),

    updateNodeWithoutHistory: (id: string, updates: Partial<SceneNode>) =>
      set((state) => {
        const existing = state.nodesById[id];
        if (!existing) return state;

        let updated = { ...existing, ...updates } as FlatSceneNode;
        if (updated.type === "text" && hasTextMeasureProps(updates)) {
          updated = syncTextDimensions(updated);
        }

        const newNodesById = { ...state.nodesById, [id]: updated };
        const componentArtifactsById = markComponentArtifactsStaleFromNative(
          state.componentArtifactsById,
          [existing],
        );

        return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
      }),

    updateNodesWithoutHistory: (updatesById: Record<string, Partial<SceneNode>>) =>
      set((state) => {
        const ids = Object.keys(updatesById).filter((id) => state.nodesById[id]);
        if (ids.length === 0) return state;

        const newNodesById = { ...state.nodesById };
        const staleSources: FlatSceneNode[] = [];
        for (const id of ids) {
          const existing = state.nodesById[id];
          const updates = updatesById[id];
          let updated = { ...existing, ...updates } as FlatSceneNode;
          if (updated.type === "text" && hasTextMeasureProps(updates)) {
            updated = syncTextDimensions(updated);
          }
          newNodesById[id] = updated;
          staleSources.push(existing);
        }
        const componentArtifactsById = markComponentArtifactsStaleFromNative(
          state.componentArtifactsById,
          staleSources,
        );

        return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
      }),

    updateNodesById: (updatesById: Record<string, Partial<SceneNode>>) =>
      set((state) => {
        const ids = Object.keys(updatesById).filter((id) => state.nodesById[id]);
        if (ids.length === 0) return state;
        saveHistory(state);

        const newNodesById = { ...state.nodesById };
        const staleSources: FlatSceneNode[] = [];
        for (const id of ids) {
          const existing = state.nodesById[id];
          const updates = updatesById[id];
          let updated = { ...existing, ...updates } as FlatSceneNode;
          if (updated.type === "text" && hasTextMeasureProps(updates)) {
            updated = syncTextDimensions(updated);
          }
          newNodesById[id] = updated;
          staleSources.push(existing);
        }
        const componentArtifactsById = markComponentArtifactsStaleFromNative(
          state.componentArtifactsById,
          staleSources,
        );

        return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
      }),

    deleteNode: (id: string) =>
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

        // Capture the full set of ids being removed (node + descendants) so
        // connectors anchored to any of them — not just the top node — are cleaned.
        const removedNodeIds = new Set<string>([
          id,
          ...collectDescendantIds(id, state.childrenById),
        ]);

        // Remove node and all descendants
        removeNodeAndDescendants(id, newNodesById, newParentById, newChildrenById);

        // Remove connectors that referenced any removed node
        const orphanedConnectorIds = removeOrphanedConnectors(
          removedNodeIds,
          newNodesById,
          newParentById,
          newChildrenById,
        );

        // Update rootIds — filter deleted node + orphaned connectors in one pass
        const removedIds = new Set([id, ...orphanedConnectorIds]);
        const newRootIds = (parentId === null || parentId === undefined)
          ? state.rootIds.filter((rid) => !removedIds.has(rid))
          : (orphanedConnectorIds.length > 0
              ? state.rootIds.filter((rid) => !removedIds.has(rid))
              : state.rootIds);

        return {
          nodesById: newNodesById,
          parentById: newParentById,
          childrenById: newChildrenById,
          rootIds: newRootIds,
          componentArtifactsById:
            id in state.componentArtifactsById
              ? Object.fromEntries(
                  Object.entries(state.componentArtifactsById).filter(([artifactId]) => artifactId !== id),
                )
              : state.componentArtifactsById,
          _cachedTree: null,
        };
      }),

    clearNodes: () =>
      set({
        nodesById: {},
        parentById: {},
        childrenById: {},
        rootIds: [],
        componentArtifactsById: {},
        _cachedTree: null,
      }),

    setNodes: (nodes: SceneNode[]) => {
      const state = get();
      saveHistory(state);
      const flat = flattenTree(nodes);

      // Migration: convert old slot: string[] on parent to isSlot: true on children
      type FrameWithOldSlot = FlatFrameNode & { slot?: string[] };
      for (const id of Object.keys(flat.nodesById)) {
        const node = flat.nodesById[id];
        if (node.type !== "frame") continue;
        const frame = node as FrameWithOldSlot;
        if (!Array.isArray(frame.slot)) continue;
        for (const slotChildId of frame.slot) {
          const child = flat.nodesById[slotChildId];
          if (child?.type === "frame") {
            flat.nodesById[slotChildId] = { ...child, isSlot: true } as FlatSceneNode;
          }
        }
        const { slot: _, ...rest } = frame;
        flat.nodesById[id] = rest as FlatSceneNode;
      }

      const synced = syncAllTextDimensionsFlat(flat.nodesById);
      set({
        nodesById: synced,
        parentById: flat.parentById,
        childrenById: flat.childrenById,
        rootIds: flat.rootIds,
        componentArtifactsById: state.componentArtifactsById,
        _cachedTree: null,
      });
      loadGoogleFontsFromNodes(nodes);
      // Re-sync once the browser finishes loading any in-flight fonts
      // (covers custom @font-face fonts, not only Google Fonts).
      if (typeof document !== "undefined" && "fonts" in document) {
        document.fonts.ready.then(() => {
          resyncAllTextNodeDimensionsInStore(get, set);
        });
      }
    },

    setNodesWithoutHistory: (nodes: SceneNode[]) => {
      const flat = flattenTree(nodes);
      set({
        nodesById: flat.nodesById,
        parentById: flat.parentById,
        childrenById: flat.childrenById,
        rootIds: flat.rootIds,
        componentArtifactsById: get().componentArtifactsById,
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
        componentArtifactsById: { ...(snapshot.componentArtifactsById ?? {}) },
        _cachedTree: null,
      });
      // Restore variables when the snapshot carries them (all createSnapshot-based
      // snapshots do), so undo/redo of variable edits round-trips. Snapshots that
      // omit variables (unknown sources) leave the variable store untouched.
      if (snapshot.variables) {
        useVariableStore.setState({ variables: snapshot.variables });
      }
      // Restore persistent ruler guides when the snapshot carries them (all
      // createSnapshot-based snapshots do), mirroring the variables restore
      // above, so guide create/move/delete round-trips through undo/redo.
      if (snapshot.guides) {
        useGuidesStore.getState().setGuides(snapshot.guides);
      }
      // Restore text styles when the snapshot carries them (all createSnapshot-based
      // snapshots do), mirroring the variables restore above, so text-style
      // add/update/delete round-trips through undo/redo.
      if (snapshot.textStyles) {
        useTextStyleStore.setState({ textStyles: snapshot.textStyles });
      }
      // Restore shared fill/effect styles the same way (all createSnapshot-based
      // snapshots carry them), so style add/update/delete/apply/detach
      // round-trips through undo/redo.
      if (snapshot.fillStyles) {
        useStyleStore.setState({ fillStyles: snapshot.fillStyles });
      }
      if (snapshot.effectStyles) {
        useStyleStore.setState({ effectStyles: snapshot.effectStyles });
      }
      if (!historySelection) return;
      useSelectionStore.setState({
        selectedIds: historySelection.selectedIds.filter((id) => validIds.has(id)),
        editingInstanceId: null,
        instanceContext: null,
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
        activeEmbedId: null,
      });
    },

    reorderNode: (fromIndex: number, toIndex: number) =>
      set((state) => {
        saveHistory(state);
        const newRootIds = [...state.rootIds];
        const [removed] = newRootIds.splice(fromIndex, 1);
        newRootIds.splice(toIndex, 0, removed);
        return { rootIds: newRootIds, _cachedTree: null };
      }),

    setVisibility: (id: string, visible: boolean) =>
      set((state) => {
        const existing = state.nodesById[id];
        if (!existing) return state;
        saveHistory(state);
        return {
          nodesById: { ...state.nodesById, [id]: { ...existing, visible } },
          _cachedTree: null,
        };
      }),

    toggleVisibility: (id: string) =>
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

    toggleFrameExpanded: (id: string) =>
      set((state) => {
        const newSet = new Set(state.expandedFrameIds);
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
        return { expandedFrameIds: newSet };
      }),

    setFrameExpanded: (id: string, expanded: boolean) =>
      set((state) => {
        const newSet = new Set(state.expandedFrameIds);
        if (expanded) {
          newSet.add(id);
        } else {
          newSet.delete(id);
        }
        return { expandedFrameIds: newSet };
      }),

    expandAncestors: (ids: string[]) =>
      set((state) => {
        const allExpanded = ids.every((id) => state.expandedFrameIds.has(id));
        if (allExpanded) return state;
        const newSet = new Set(state.expandedFrameIds);
        for (const id of ids) newSet.add(id);
        return { expandedFrameIds: newSet };
      }),

    collapseAllFrames: () => set({ expandedFrameIds: new Set<string>() }),

    moveNode: (nodeId: string, newParentId: string | null, newIndex: number) =>
      set((state) => {
        const node = state.nodesById[nodeId];
        if (!node) return state;

        // Guard against creating a cycle: a node cannot become its own parent or
        // a child of one of its own descendants. Walk up from the target parent;
        // if we reach nodeId, the move would form a cycle (which would later
        // stack-overflow tree traversal), so reject it as a no-op.
        if (newParentId !== null) {
          let ancestor: string | null | undefined = newParentId;
          while (ancestor !== null && ancestor !== undefined) {
            if (ancestor === nodeId) return state;
            ancestor = state.parentById[ancestor];
          }
        }

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
  };
}
