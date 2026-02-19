import type {
  SceneNode,
  RefNode,
  FrameNode,
  GroupNode,
  DescendantOverride,
  TextNode,
} from "../../types/scene";
import { generateId, buildTree } from "../../types/scene";
import { deepCloneNode } from "../../utils/cloneNode";
import { resolveRefToFrame } from "@/utils/instanceUtils";
import { insertTreeIntoFlat } from "./helpers/flatStoreHelpers";
import { measureTextAutoSize, measureTextFixedWidthHeight } from "../../utils/textMeasure";
import { saveHistory } from "./helpers/history";
import type { SceneState } from "./types";

/** Clone a tree node giving all descendants new IDs but keeping the root ID */
function cloneChildrenWithNewIds(node: SceneNode): SceneNode {
  if (node.type === "frame" || node.type === "group") {
    const container = node as FrameNode | GroupNode;
    return {
      ...container,
      children: container.children.map((child) => cloneChildWithNewId(child)),
    } as SceneNode;
  }
  return { ...node } as SceneNode;
}

function cloneChildWithNewId(node: SceneNode): SceneNode {
  const newId = generateId();
  if (node.type === "frame" || node.type === "group") {
    const container = node as FrameNode | GroupNode;
    return {
      ...container,
      id: newId,
      children: container.children.map((child) => cloneChildWithNewId(child)),
    } as SceneNode;
  }
  return { ...node, id: newId } as SceneNode;
}

function syncTextNodeDimensions(node: SceneNode): SceneNode {
  if (node.type !== "text") return node;
  const textNode = node as TextNode;
  const mode = textNode.textWidthMode;

  if (!mode || mode === "auto") {
    const measured = measureTextAutoSize(textNode);
    return { ...textNode, width: measured.width, height: measured.height };
  }
  if (mode === "fixed") {
    const measuredHeight = measureTextFixedWidthHeight(textNode);
    return { ...textNode, height: measuredHeight };
  }
  return textNode;
}

function getOverrideByPath(
  overrides: Record<string, DescendantOverride>,
  pathSegments: string[],
): DescendantOverride | undefined {
  let cursor: Record<string, DescendantOverride> = overrides;
  let current: DescendantOverride | undefined;
  for (let i = 0; i < pathSegments.length; i++) {
    current = cursor[pathSegments[i]];
    if (!current) return undefined;
    if (i < pathSegments.length - 1) {
      cursor = current.descendants ?? {};
    }
  }
  return current;
}

function setOverrideByPath(
  overrides: Record<string, DescendantOverride>,
  pathSegments: string[],
  patch: DescendantOverride,
): Record<string, DescendantOverride> {
  const next: Record<string, DescendantOverride> = { ...overrides };
  if (pathSegments.length === 0) return next;

  let cursor = next;
  for (let i = 0; i < pathSegments.length - 1; i++) {
    const segment = pathSegments[i];
    const current = cursor[segment] ?? {};
    const descendants = { ...(current.descendants ?? {}) };
    cursor[segment] = { ...current, descendants };
    cursor = descendants;
  }

  const leaf = pathSegments[pathSegments.length - 1];
  cursor[leaf] = {
    ...(cursor[leaf] ?? {}),
    ...patch,
  };
  return next;
}

export function createInstanceOperations(
  _get: () => SceneState,
  set: (partial: Partial<SceneState> | ((state: SceneState) => Partial<SceneState>)) => void,
) {
  return {
    updateDescendantOverride: (
      instanceId: string,
      descendantId: string,
      updates: DescendantOverride,
    ) =>
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

    resetDescendantOverride: (
      instanceId: string,
      descendantId: string,
      property?: keyof DescendantOverride,
    ) =>
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

    replaceSlotContent: (instanceId: string, slotChildId: string, newNode: SceneNode) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        saveHistory(state);

        const refNode = existing as RefNode;
        const updated: RefNode = {
          ...refNode,
          slotContent: {
            ...refNode.slotContent,
            [slotChildId]: deepCloneNode(newNode),
          },
        };

        return {
          nodesById: { ...state.nodesById, [instanceId]: updated },
          _cachedTree: null,
        };
      }),

    resetSlotContent: (instanceId: string, slotChildId: string) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        const refNode = existing as RefNode;
        if (!refNode.slotContent?.[slotChildId]) return state;
        saveHistory(state);

        const { [slotChildId]: _, ...remaining } = refNode.slotContent!;
        const updated: RefNode = {
          ...refNode,
          slotContent: Object.keys(remaining).length > 0 ? remaining : undefined,
        };

        return {
          nodesById: { ...state.nodesById, [instanceId]: updated },
          _cachedTree: null,
        };
      }),

    updateSlotContentNode: (
      instanceId: string,
      slotChildId: string,
      updates: Partial<SceneNode>,
    ) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        const refNode = existing as RefNode;
        const slotNode = refNode.slotContent?.[slotChildId];
        if (!slotNode) return state;
        saveHistory(state);

        const updatedSlotNode = { ...slotNode, ...updates } as SceneNode;
        const updated: RefNode = {
          ...refNode,
          slotContent: {
            ...refNode.slotContent,
            [slotChildId]: updatedSlotNode,
          },
        };

        return {
          nodesById: { ...state.nodesById, [instanceId]: updated },
          _cachedTree: null,
        };
      }),

    updateDescendantTextWithoutHistory: (
      instanceId: string,
      descendantId: string,
      text: string,
      descendantPath?: string,
    ) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        const refNode = existing as RefNode;
        const pathSegments = (descendantPath ?? descendantId)
          .split("/")
          .filter(Boolean);
        if (pathSegments.length === 0) return state;
        const leafId = pathSegments[pathSegments.length - 1];

        // Check if descendant has slot content replacement
        if (pathSegments.length === 1 && refNode.slotContent?.[leafId]) {
          const slotNode = refNode.slotContent[leafId];
          const updatedSlotNode = syncTextNodeDimensions({
            ...slotNode,
            text,
          } as SceneNode);
          const updated: RefNode = {
            ...refNode,
            slotContent: {
              ...refNode.slotContent,
              [leafId]: updatedSlotNode,
            },
          };
          return {
            nodesById: { ...state.nodesById, [instanceId]: updated },
            _cachedTree: null,
          };
        }

        // Otherwise update descendant override
        const descendants = refNode.descendants || {};
        const override =
          getOverrideByPath(descendants, pathSegments) || {};
        const updated: RefNode = {
          ...refNode,
          descendants: setOverrideByPath(descendants, pathSegments, {
            ...override,
            text,
          }),
        };
        return {
          nodesById: { ...state.nodesById, [instanceId]: updated },
          _cachedTree: null,
        };
      }),

    detachInstance: (instanceId: string) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        saveHistory(state);

        const refNode = existing as RefNode;

        // Build tree to resolve the ref
        const allNodes = buildTree(
          state.rootIds,
          state.nodesById,
          state.childrenById,
        );

        // Resolve ref into a frame with overrides applied
        const resolvedFrame = resolveRefToFrame(refNode, allNodes);
        if (!resolvedFrame) return state;

        // Clone children with new IDs (the frame keeps the ref's ID)
        const detachedFrame = cloneChildrenWithNewIds(resolvedFrame) as FrameNode;

        // Remove old ref node from flat store
        const newNodesById = { ...state.nodesById };
        const newParentById = { ...state.parentById };
        const newChildrenById = { ...state.childrenById };

        delete newNodesById[instanceId];
        delete newChildrenById[instanceId];
        // parentById[instanceId] stays the same

        // Insert the detached frame tree into flat store
        const parentId = state.parentById[instanceId];
        insertTreeIntoFlat(
          detachedFrame,
          parentId,
          newNodesById,
          newParentById,
          newChildrenById,
        );

        // rootIds: replace if it was a root node (no change needed since ID stays the same)
        return {
          nodesById: newNodesById,
          parentById: newParentById,
          childrenById: newChildrenById,
          _cachedTree: null,
        };
      }),
  };
}
