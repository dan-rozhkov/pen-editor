import type {
  SceneNode,
  RefNode,
  DescendantOverride,
} from "../../types/scene";
import { deepCloneNode } from "../../utils/cloneNode";
import { saveHistory } from "./helpers/history";
import type { SceneState } from "./types";

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
    ) =>
      set((state) => {
        const existing = state.nodesById[instanceId];
        if (!existing || existing.type !== "ref") return state;
        const refNode = existing as RefNode;

        // Check if descendant has slot content replacement
        if (refNode.slotContent?.[descendantId]) {
          const slotNode = refNode.slotContent[descendantId];
          const updated: RefNode = {
            ...refNode,
            slotContent: {
              ...refNode.slotContent,
              [descendantId]: { ...slotNode, text } as SceneNode,
            },
          };
          return {
            nodesById: { ...state.nodesById, [instanceId]: updated },
            _cachedTree: null,
          };
        }

        // Otherwise update descendant override
        const descendants = refNode.descendants || {};
        const override = descendants[descendantId] || {};
        const updated: RefNode = {
          ...refNode,
          descendants: {
            ...descendants,
            [descendantId]: { ...override, text },
          },
        };
        return {
          nodesById: { ...state.nodesById, [instanceId]: updated },
          _cachedTree: null,
        };
      }),
  };
}
