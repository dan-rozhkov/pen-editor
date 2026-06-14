import type {
  SceneNode,
  FlatSceneNode,
  FlatFrameNode,
  FrameNode,
  InstanceOverrideUpdateProps,
  RefNode,
} from "../../types/scene";
import { saveHistory } from "./helpers/history";
import { syncTextDimensions, hasTextMeasureProps } from "./helpers/textSync";
import {
  insertTreeIntoFlat,
  removeNodeAndDescendants,
} from "./helpers/flatStoreHelpers";
import type { SceneState } from "./types";
import { deepCloneNode } from "@/utils/cloneNode";
import { resolveRefToFrame } from "@/utils/instanceRuntime";
import { isInsideReusableComponent } from "@/utils/componentUtils";
import type { StoreApi } from "zustand";

type SetState = StoreApi<SceneState>["setState"];
type GetState = StoreApi<SceneState>["getState"];

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

/** Walk a replacement node tree and apply updates at the given path segments. */
function updateNodeInReplaceTree(
  node: SceneNode,
  segments: string[],
  segIdx: number,
  updates: InstanceOverrideUpdateProps,
): SceneNode {
  const targetId = segments[segIdx];
  if (node.id === targetId) {
    // Last segment — apply updates directly
    if (segIdx === segments.length - 1) {
      let updated = { ...node, ...updates } as SceneNode;
      if (updated.type === "text" && hasTextMeasureProps(updates as Partial<SceneNode>)) {
        updated = syncTextDimensions(updated);
      }
      return updated;
    }
    // Not last segment — drill deeper
    if (node.type === "ref") {
      const ref = node as RefNode;
      const subPath = segments.slice(segIdx + 1).join("/");
      const existingOverride = ref.overrides?.[subPath];
      const existingProps = existingOverride?.kind === "update" ? existingOverride.props : {};
      return {
        ...ref,
        overrides: {
          ...ref.overrides,
          [subPath]: { kind: "update" as const, props: { ...existingProps, ...updates } },
        },
      } as SceneNode;
    }
    if (node.type === "frame" || node.type === "group") {
      const container = node as FrameNode;
      return {
        ...container,
        children: container.children.map((c) => updateNodeInReplaceTree(c, segments, segIdx + 1, updates)),
      } as SceneNode;
    }
  }
  // Not the target — recurse into containers
  if (node.type === "frame" || node.type === "group") {
    const container = node as FrameNode;
    const newChildren = container.children.map((c) => updateNodeInReplaceTree(c, segments, segIdx, updates));
    if (newChildren.every((c, i) => c === container.children[i])) return node;
    return { ...container, children: newChildren } as SceneNode;
  }
  return node;
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

  // Check if the path targets a node inside a replaced ancestor (e.g., a slot).
  // In that case, update the child within the replacement node tree directly.
  const pathSegments = path.split("/");
  if (pathSegments.length > 1) {
    for (let i = 1; i < pathSegments.length; i++) {
      const ancestorPath = pathSegments.slice(0, i).join("/");
      const ancestorOverride = existingOverrides[ancestorPath];
      if (ancestorOverride?.kind === "replace") {
        const relativeSegments = pathSegments.slice(i);
        const updatedNode = updateNodeInReplaceTree(ancestorOverride.node, relativeSegments, 0, updates);
        if (updatedNode === ancestorOverride.node) return {};
        return {
          nodesById: {
            ...state.nodesById,
            [instanceId]: {
              ...refNode,
              overrides: {
                ...existingOverrides,
                [ancestorPath]: { kind: "replace" as const, node: updatedNode },
              },
            },
          },
          _cachedTree: null,
        };
      }
    }
  }

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

export function createInstanceOperations(set: SetState, get: GetState) {
  return {
    updateInstanceOverride: (instanceId: string, path: string, updates: InstanceOverrideUpdateProps) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        saveHistory(state);
        return applyInstanceOverrideUpdate(state, instanceId, path, updates);
      }),

    updateInstanceOverrideWithoutHistory: (instanceId: string, path: string, updates: InstanceOverrideUpdateProps) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        return applyInstanceOverrideUpdate(state, instanceId, path, updates);
      }),

    replaceInstanceNode: (instanceId: string, path: string, newNode: SceneNode) =>
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

    updateSlotChildWithoutHistory: (instanceId: string, slotPath: string, relativePath: string, updates: Partial<SceneNode>) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        const refNode = existing as RefNode;
        const override = refNode.overrides?.[slotPath];
        if (!override || override.kind !== "replace") return state;

        const segments = relativePath.split("/");
        const updatedNode = updateNodeInReplaceTree(override.node, segments, 0, updates);
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

    resetInstanceOverride: (instanceId: string, path: string, property?: keyof InstanceOverrideUpdateProps) =>
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

    toggleSlot: (frameId: string) =>
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

    detachInstance: (instanceId: string): string | null => {
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
  };
}
