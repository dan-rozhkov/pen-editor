import { create } from "zustand";
import type { TextStyle } from "../types/textStyle";
import {
  generateTextStyleId,
  TEXT_STYLE_PROPERTY_KEYS,
  assignTextStyleProperty,
} from "../types/textStyle";
import { resolveTextStyleProperties } from "../utils/textStyleResolve";
import { useHistoryStore, withHistoryBatch } from "./historyStore";
import { useSceneStore, createSnapshot } from "./sceneStore";
import type { TextNode } from "../types/scene";

interface TextStyleState {
  textStyles: TextStyle[];

  // CRUD operations
  addTextStyle: (style: TextStyle) => void;
  updateTextStyle: (id: string, updates: Partial<Omit<TextStyle, "id">>) => void;
  deleteTextStyle: (id: string) => void;

  // Bulk operations (for serialization)
  setTextStyles: (styles: TextStyle[]) => void;

  // Node binding operations (the "apply"/"detach"/"create from selection" flows)
  applyStyleToNode: (nodeId: string, styleId: string) => void;
  detachStyleFromNode: (nodeId: string) => void;
  createStyleFromNode: (nodeId: string, name: string) => TextStyle | null;
}

/**
 * Record an undo snapshot before a text-style edit. Mirrors
 * `saveVariableHistory` — the whole editor state (scene + current text
 * styles) is snapshotted so undo/redo round-trips style add/update/delete the
 * same way it does scene edits.
 */
function saveTextStyleHistory(): void {
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
}

/** Push a style's resolved properties onto every text node bound to it, honoring per-node overrides. */
function propagateStyleUpdate(style: TextStyle): void {
  const scene = useSceneStore.getState();
  const updatesById: Record<string, Partial<TextNode>> = {};
  for (const node of Object.values(scene.nodesById)) {
    if (node.type !== "text" || node.textStyleId !== style.id) continue;
    const updates = resolveTextStyleProperties(style, node.textStyleOverrides ?? []);
    if (Object.keys(updates).length > 0) {
      updatesById[node.id] = updates;
    }
  }
  if (Object.keys(updatesById).length > 0) {
    scene.updateNodesById(updatesById);
  }
}

/** Unbind every node currently bound to a (deleted) style, keeping its last-resolved literal values. */
function unbindNodesFromStyle(styleId: string): void {
  const scene = useSceneStore.getState();
  const updatesById: Record<string, Partial<TextNode>> = {};
  for (const node of Object.values(scene.nodesById)) {
    if (node.type === "text" && node.textStyleId === styleId) {
      updatesById[node.id] = { textStyleId: undefined, textStyleOverrides: undefined };
    }
  }
  if (Object.keys(updatesById).length > 0) {
    scene.updateNodesById(updatesById);
  }
}

export const useTextStyleStore = create<TextStyleState>((set, get) => ({
  textStyles: [],

  addTextStyle: (style) => {
    saveTextStyleHistory();
    set((state) => ({ textStyles: [...state.textStyles, style] }));
  },

  updateTextStyle: (id, updates) => {
    // One undo step for the style edit + the propagation to every bound node:
    // snapshot once up front, then suppress the per-node history saves inside
    // `updateNodesById` (mirrors `styleClipboardActions.ts`'s paste-style batching).
    saveTextStyleHistory();
    withHistoryBatch(() => {
      let updated: TextStyle | undefined;
      set((state) => ({
        textStyles: state.textStyles.map((s) => {
          if (s.id !== id) return s;
          updated = { ...s, ...updates };
          return updated;
        }),
      }));
      if (updated) propagateStyleUpdate(updated);
    });
  },

  deleteTextStyle: (id) => {
    // One undo step for "remove the style" + "unbind every node that used it".
    saveTextStyleHistory();
    withHistoryBatch(() => {
      set((state) => ({ textStyles: state.textStyles.filter((s) => s.id !== id) }));
      unbindNodesFromStyle(id);
    });
  },

  // Bulk replace (document load / serialization) — not an undoable user edit.
  setTextStyles: (textStyles) => set({ textStyles }),

  applyStyleToNode: (nodeId, styleId) => {
    const style = get().textStyles.find((s) => s.id === styleId);
    if (!style) return;
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node || node.type !== "text") return;
    const updates = resolveTextStyleProperties(style);
    scene.updateNode(nodeId, {
      ...updates,
      textStyleId: styleId,
      textStyleOverrides: [],
    });
  },

  detachStyleFromNode: (nodeId) => {
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node || node.type !== "text") return;
    scene.updateNode(nodeId, { textStyleId: undefined, textStyleOverrides: undefined });
  },

  createStyleFromNode: (nodeId, name) => {
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId] as TextNode | undefined;
    if (!node || node.type !== "text") return null;

    const style: TextStyle = { id: generateTextStyleId(), name };
    for (const key of TEXT_STYLE_PROPERTY_KEYS) {
      assignTextStyleProperty(style, key, node[key]);
    }

    // One undo step for "add the style" + "bind this node to it".
    saveTextStyleHistory();
    withHistoryBatch(() => {
      set((state) => ({ textStyles: [...state.textStyles, style] }));
      scene.updateNode(nodeId, { textStyleId: style.id, textStyleOverrides: [] });
    });
    return style;
  },
}));
