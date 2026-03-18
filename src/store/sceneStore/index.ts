import { create } from "zustand";
import type {
  FlatSceneNode,
  FlatSnapshot,
  HistorySnapshot,
  FlatFrameNode,
  FrameNode,
  SceneNode,
  InstanceOverrideUpdateProps,
  RefNode,
  ConnectorNode,
  ComponentArtifact,
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
} from "./helpers/flatStoreHelpers";
import { createComplexOperations } from "./complexOperations";
import type { SceneState } from "./types";
import { convertDesignNodesToHtml } from "@/lib/designToHtml";
import { deepCloneNode } from "@/utils/cloneNode";
import { resolveRefToFrame } from "@/utils/instanceRuntime";
import { isInsideReusableComponent } from "@/utils/componentUtils";

// Re-export types and utilities
export type { SceneState } from "./types";
export { createSnapshot } from "./helpers/history";

function cloneArtifacts(
  artifacts: Record<string, ComponentArtifact>,
): Record<string, ComponentArtifact> {
  return Object.fromEntries(
    Object.entries(artifacts).map(([id, artifact]) => [id, { ...artifact }]),
  );
}

function markComponentArtifactStaleFromNative(
  artifacts: Record<string, ComponentArtifact>,
  node: FlatSceneNode | undefined,
): Record<string, ComponentArtifact> {
  if (!node || node.type !== "frame" || !(node as FlatFrameNode).reusable) return artifacts;
  const next = cloneArtifacts(artifacts);
  const existing = next[node.id];
  next[node.id] = {
    authoringHtml: existing?.authoringHtml,
    sourceTemplate: existing?.sourceTemplate,
    revision: (existing?.revision ?? 0) + 1,
    syncState: existing?.authoringHtml || existing?.sourceTemplate ? "stale_from_native" : "missing",
  };
  return next;
}

function markComponentArtifactsStaleFromNative(
  artifacts: Record<string, ComponentArtifact>,
  nodes: Array<FlatSceneNode | undefined>,
): Record<string, ComponentArtifact> {
  return nodes.reduce(
    (next, node) => markComponentArtifactStaleFromNative(next, node),
    artifacts,
  );
}

function deleteOverridePath(
  overrides: RefNode["overrides"],
  path: string,
): RefNode["overrides"] {
  if (!overrides?.[path]) return overrides;
  const next = { ...overrides };
  delete next[path];
  return Object.keys(next).length > 0 ? next : undefined;
}

function pruneOverrideProperty(
  overrides: RefNode["overrides"],
  path: string,
  property: keyof InstanceOverrideUpdateProps,
): RefNode["overrides"] {
  const currentOverride = overrides?.[path];
  if (!currentOverride) return overrides;
  if (currentOverride.kind !== "update") {
    return deleteOverridePath(overrides, path);
  }

  const nextProps = { ...currentOverride.props };
  delete nextProps[property];
  if (Object.keys(nextProps).length === 0) {
    return deleteOverridePath(overrides, path);
  }

  return {
    ...overrides,
    [path]: {
      kind: "update",
      props: nextProps,
    },
  };
}

/** Shared logic for applying an override update — handles both "update" and "replace" override kinds. */
function applyInstanceOverrideUpdate(
  state: SceneState,
  instanceId: string,
  path: string,
  updates: InstanceOverrideUpdateProps,
): Partial<SceneState> {
  const refNode = state.nodesById[instanceId] as RefNode;
  const existingOverrides = refNode.overrides ?? {};
  const existingOverride = existingOverrides[path];

  let newOverride: import("../../types/scene").InstanceOverride;
  if (existingOverride?.kind === "replace") {
    // Merge updates into the replacement node
    newOverride = {
      kind: "replace",
      node: { ...existingOverride.node, ...updates } as SceneNode,
    };
  } else {
    const existingProps =
      existingOverride?.kind === "update" ? existingOverride.props : {};
    newOverride = {
      kind: "update",
      props: { ...existingProps, ...updates },
    };
  }

  return {
    nodesById: {
      ...state.nodesById,
      [instanceId]: {
        ...refNode,
        overrides: { ...existingOverrides, [path]: newOverride },
      },
    },
    _cachedTree: null,
  };
}

// ----- Store -----

export const useSceneStore = create<SceneState>((set, get) => ({
  nodesById: {},
  parentById: {},
  childrenById: {},
  rootIds: [],
  componentArtifactsById: {},
  _cachedTree: null,
  expandedFrameIds: new Set<string>(),
  pageBackground: "#f5f5f5",

  // Lazy tree builder for backward compat
  getNodes: () => getCachedTree(get()),

  // ----- Basic Mutations -----

  addNode: (node) => {
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
        componentArtifactsById: state.componentArtifactsById,
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

      const newNodesById = { ...state.nodesById, [id]: updated };
      const componentArtifactsById = markComponentArtifactsStaleFromNative(
        state.componentArtifactsById,
        [existing],
      );

      return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
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
      const componentArtifactsById = markComponentArtifactsStaleFromNative(
        state.componentArtifactsById,
        ids.map((id) => state.nodesById[id]),
      );

      return { nodesById: newNodesById, componentArtifactsById, _cachedTree: null };
    }),

  updateNodeWithoutHistory: (id, updates) =>
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

      // Remove orphaned connectors referencing the deleted node
      const orphanedConnectorIds: string[] = [];
      for (const nodeId of Object.keys(newNodesById)) {
        const node = newNodesById[nodeId];
        if (node?.type === "connector") {
          const conn = node as ConnectorNode;
          if (conn.startConnection.nodeId === id || conn.endConnection.nodeId === id) {
            orphanedConnectorIds.push(nodeId);
          }
        }
      }
      for (const connId of orphanedConnectorIds) {
        const connParentId = newParentById[connId];
        if (connParentId !== null && connParentId !== undefined) {
          newChildrenById[connParentId] = (newChildrenById[connParentId] ?? []).filter(
            (cid) => cid !== connId,
          );
        }
        removeNodeAndDescendants(connId, newNodesById, newParentById, newChildrenById);
      }

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

  setNodes: (nodes) => {
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

  updateInstanceOverride: (instanceId, path, updates) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;
      saveHistory(state);
      return applyInstanceOverrideUpdate(state, instanceId, path, updates);
    }),

  updateInstanceOverrideWithoutHistory: (instanceId, path, updates) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;
      return applyInstanceOverrideUpdate(state, instanceId, path, updates);
    }),

  replaceInstanceNode: (instanceId, path, newNode) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;
      saveHistory(state);

      const refNode = existing as RefNode;
      const existingOverrides = refNode.overrides ?? {};

      return {
        nodesById: {
          ...state.nodesById,
          [instanceId]: {
            ...refNode,
            overrides: {
              ...existingOverrides,
              [path]: {
                kind: "replace",
                node: deepCloneNode(newNode),
              },
            },
          },
        },
        _cachedTree: null,
      };
    }),

  updateSlotChildWithoutHistory: (instanceId, slotPath, relativePath, updates) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;
      const refNode = existing as RefNode;
      const override = refNode.overrides?.[slotPath];
      if (!override || override.kind !== "replace") return state;

      const segments = relativePath.split("/");
      const needsTextSync = hasTextMeasureProps(updates as Partial<SceneNode>);

      // Walk the replacement tree following the path segments.
      // When encountering a ref node, update its overrides for the remaining sub-path.
      const updateAtPath = (node: SceneNode, segIdx: number): SceneNode => {
        const targetId = segments[segIdx];
        if (node.id === targetId) {
          // Last segment — apply updates directly
          if (segIdx === segments.length - 1) {
            let updated = { ...node, ...updates } as SceneNode;
            if (updated.type === "text" && needsTextSync) {
              updated = syncTextDimensions(updated);
            }
            return updated;
          }
          // Not last segment — drill deeper
          if (node.type === "ref") {
            // Update the ref's overrides for the remaining sub-path
            const subPath = segments.slice(segIdx + 1).join("/");
            const leafId = segments[segments.length - 1];
            const ref = node as RefNode;
            const existingOverride = ref.overrides?.[subPath];
            const existingProps = existingOverride?.kind === "update" ? existingOverride.props : {};
            let mergedProps = { ...existingProps, ...updates };
            if (needsTextSync) {
              // Check if the target node in the component is text
              const compNode = state.nodesById[ref.componentId];
              if (compNode) {
                // Just store the override — text sync happens at resolve time
                void leafId;
              }
            }
            return {
              ...ref,
              overrides: {
                ...ref.overrides,
                [subPath]: { kind: "update" as const, props: mergedProps },
              },
            } as SceneNode;
          }
          if (node.type === "frame" || node.type === "group") {
            const container = node as FrameNode;
            return {
              ...container,
              children: container.children.map((c) => updateAtPath(c, segIdx + 1)),
            } as SceneNode;
          }
        }
        // Not the target — recurse into containers
        if (node.type === "frame" || node.type === "group") {
          const container = node as FrameNode;
          const newChildren = container.children.map((c) => updateAtPath(c, segIdx));
          if (newChildren.every((c, i) => c === container.children[i])) return node;
          return { ...container, children: newChildren } as SceneNode;
        }
        return node;
      };

      const updatedNode = updateAtPath(override.node, 0);
      if (updatedNode === override.node) return state;

      return {
        nodesById: {
          ...state.nodesById,
          [instanceId]: {
            ...refNode,
            overrides: {
              ...refNode.overrides,
              [slotPath]: { kind: "replace" as const, node: updatedNode },
            },
          },
        },
        _cachedTree: null,
      };
    }),

  resetInstanceOverride: (instanceId, path, property) =>
    set((state) => {
      const existing = state.nodesById[instanceId];
      if (!existing || existing.type !== "ref") return state;

      const refNode = existing as RefNode;
      const existingOverrides = refNode.overrides;
      const currentOverride = existingOverrides?.[path];
      if (!currentOverride) return state;
      saveHistory(state);

      const overrides = property
        ? pruneOverrideProperty(existingOverrides, path, property)
        : deleteOverridePath(existingOverrides, path);

      return {
        nodesById: {
          ...state.nodesById,
          [instanceId]: { ...refNode, overrides },
        },
        _cachedTree: null,
      };
    }),

  toggleSlot: (frameId) =>
    set((state) => {
      const existing = state.nodesById[frameId];
      if (!existing || existing.type !== "frame") return state;
      const frame = existing as FlatFrameNode;
      // Must be inside a reusable component
      if (!isInsideReusableComponent(frameId, state.nodesById, state.parentById)) return state;
      // Must have no children (unless already a slot — allow toggling off)
      const childIds = state.childrenById[frameId] ?? [];
      if (childIds.length > 0 && !frame.isSlot) return state;
      saveHistory(state);

      return {
        nodesById: {
          ...state.nodesById,
          [frameId]: {
            ...frame,
            isSlot: frame.isSlot ? undefined : true,
          } as FlatSceneNode,
        },
        _cachedTree: null,
      };
    }),

  detachInstance: (instanceId) => {
    const state = get();
    const resolved = resolveRefToFrame(instanceId, state.nodesById, state.childrenById);
    if (!resolved) return null;

    saveHistory(state);

    const parentId = state.parentById[instanceId];
    const siblings = parentId != null ? (state.childrenById[parentId] ?? []) : state.rootIds;
    const index = siblings.indexOf(instanceId);
    const newNodesById = { ...state.nodesById };
    const newParentById = { ...state.parentById };
    const newChildrenById = { ...state.childrenById };

    removeNodeAndDescendants(instanceId, newNodesById, newParentById, newChildrenById);
    insertTreeIntoFlat(resolved, parentId ?? null, newNodesById, newParentById, newChildrenById);

    const newRootIds = [...state.rootIds];
    if (parentId != null) {
      const updated = [...siblings];
      if (index >= 0) updated.splice(index, 1, resolved.id);
      newChildrenById[parentId] = updated;
    } else if (index >= 0) {
      newRootIds.splice(index, 1, resolved.id);
    }

    set({
      nodesById: newNodesById,
      parentById: newParentById,
      childrenById: newChildrenById,
      rootIds: newRootIds,
      _cachedTree: null,
    });
    return resolved.id;
  },

  syncComponentToHtml: (componentId) =>
    set((state) => {
      const node = state.nodesById[componentId];
      if (!node || node.type !== "frame" || !(node as FlatFrameNode).reusable) return state;

      const allNodes = state.getNodes();
      const html = convertDesignNodesToHtml(componentId, state.nodesById, state.childrenById, allNodes, { isComponent: true });
      const existing = state.componentArtifactsById[componentId];

      return {
        componentArtifactsById: {
          ...state.componentArtifactsById,
          [componentId]: {
            authoringHtml: html,
            sourceTemplate: existing?.sourceTemplate,
            revision: existing?.revision ?? 1,
            syncState: "in_sync",
          },
        },
      };
    }),

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
