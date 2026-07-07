import { create } from "zustand";
import type { EffectStyle, FillStyle } from "../types/style";
import type { Effect, Paint, ShadowEffect } from "../types/scene";
import { resolveFillStylePaint, getFills, clearLegacyFillProps } from "../utils/fillUtils";
import { resolveColor } from "../utils/colorUtils";
import { generateId } from "../types/scene";
import { useHistoryStore } from "./historyStore";
import { useSceneStore, createSnapshot } from "./sceneStore";
import { useVariableStore } from "./variableStore";
import { getEffectiveThemeForNode } from "../utils/nodeThemeUtils";

/**
 * Detach must FREEZE the value the user currently sees, not leave a live
 * variable/theme reference behind. Resolve a paint's `colorBinding` (and a
 * `$--var` direct reference) against the node's effective theme, writing the
 * concrete color inline and dropping the binding.
 */
function freezePaintColor(paint: Paint, nodeId: string): Paint {
  if (paint.type !== "solid") return paint;
  const theme = getEffectiveThemeForNode(nodeId);
  const variables = useVariableStore.getState().variables;
  const resolved = resolveColor(paint.color, paint.colorBinding, variables, theme);
  const { colorBinding: _binding, ...rest } = paint;
  return { ...rest, color: resolved ?? paint.color };
}

/** Same freeze, per shadow effect in a detached effect stack. */
function freezeEffectColor(effect: Effect, nodeId: string): Effect {
  if (effect.type !== "shadow" || !effect.colorBinding) return { ...effect };
  const theme = getEffectiveThemeForNode(nodeId);
  const variables = useVariableStore.getState().variables;
  const shadow = effect as ShadowEffect;
  const resolved = resolveColor(shadow.color, shadow.colorBinding, variables, theme);
  const { colorBinding: _binding, ...rest } = shadow;
  return { ...rest, color: resolved ?? shadow.color };
}

interface StyleState {
  fillStyles: FillStyle[];
  effectStyles: EffectStyle[];

  // CRUD (fill styles)
  addFillStyle: (style: FillStyle) => void;
  updateFillStyle: (id: string, updates: Partial<Omit<FillStyle, "id">>) => void;
  deleteFillStyle: (id: string) => void;

  // CRUD (effect styles)
  addEffectStyle: (style: EffectStyle) => void;
  updateEffectStyle: (id: string, updates: Partial<Omit<EffectStyle, "id">>) => void;
  deleteEffectStyle: (id: string) => void;

  // Bulk operations (for serialization)
  setFillStyles: (styles: FillStyle[]) => void;
  setEffectStyles: (styles: EffectStyle[]) => void;

  // Node binding operations (the "apply"/"detach" flows). Live-resolved at
  // render time (see `utils/fillUtils.ts`) — unlike text styles, applying/
  // editing a style does NOT push values onto nodes; only `detach` inlines
  // a literal snapshot.
  applyFillStyleToPaint: (nodeId: string, paintId: string, styleId: string) => void;
  detachFillStyleFromPaint: (nodeId: string, paintId: string) => void;
  applyEffectStyleToNode: (nodeId: string, styleId: string) => void;
  detachEffectStyleFromNode: (nodeId: string) => void;

  /**
   * Convenience "apply to a whole node" entry point (used by the AI tool and
   * simple UI actions that don't target a specific paint layer): binds the
   * node's topmost paint layer to the style, or — if the node has no paint
   * layers yet — adds a single new one referencing it.
   */
  applyFillStyleToNode: (nodeId: string, styleId: string) => void;
}

/**
 * Record an undo snapshot before a style edit. Mirrors `saveVariableHistory`/
 * `saveTextStyleHistory` — the whole editor state (scene + current styles) is
 * snapshotted so undo/redo round-trips style add/update/delete the same way
 * it does scene edits.
 */
function saveStyleHistory(): void {
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
}

export const useStyleStore = create<StyleState>((set, get) => ({
  fillStyles: [],
  effectStyles: [],

  addFillStyle: (style) => {
    saveStyleHistory();
    set((state) => ({ fillStyles: [...state.fillStyles, style] }));
  },

  updateFillStyle: (id, updates) => {
    // Editing a fill style needs no propagation step: every referencing
    // paint layer only carries a `styleId`, so it re-resolves live from the
    // updated style at render time (see `getResolvedRenderableFills`).
    saveStyleHistory();
    set((state) => ({
      fillStyles: state.fillStyles.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  },

  deleteFillStyle: (id) => {
    saveStyleHistory();
    set((state) => ({ fillStyles: state.fillStyles.filter((s) => s.id !== id) }));
  },

  addEffectStyle: (style) => {
    saveStyleHistory();
    set((state) => ({ effectStyles: [...state.effectStyles, style] }));
  },

  updateEffectStyle: (id, updates) => {
    saveStyleHistory();
    set((state) => ({
      effectStyles: state.effectStyles.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    }));
  },

  deleteEffectStyle: (id) => {
    saveStyleHistory();
    set((state) => ({ effectStyles: state.effectStyles.filter((s) => s.id !== id) }));
  },

  // Bulk replace (document load / serialization) — not an undoable user edit.
  setFillStyles: (fillStyles) => set({ fillStyles }),
  setEffectStyles: (effectStyles) => set({ effectStyles }),

  applyFillStyleToPaint: (nodeId, paintId, styleId) => {
    const style = get().fillStyles.find((s) => s.id === styleId);
    if (!style) return;
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node) return;
    const fills = node.fills;
    if (!fills) return;
    const idx = fills.findIndex((p) => p.id === paintId);
    if (idx === -1) return;
    const nextFills: Paint[] = fills.map((p, i) => (i === idx ? { ...p, styleId } : p));
    scene.updateNode(nodeId, { fills: nextFills });
  },

  detachFillStyleFromPaint: (nodeId, paintId) => {
    const { fillStyles } = get();
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node?.fills) return;
    const idx = node.fills.findIndex((p) => p.id === paintId);
    if (idx === -1) return;
    const paint = node.fills[idx];
    if (!paint.styleId) return;
    const resolved = resolveFillStylePaint(paint, fillStyles);
    const { styleId: _styleId, ...inlineValue } = resolved;
    // Freeze the theme-resolved color so the detached layer no longer tracks
    // the style's variable/theme (matches what the user sees at detach time).
    const frozen = freezePaintColor({ ...inlineValue, id: paint.id } as Paint, nodeId);
    const nextFills: Paint[] = node.fills.map((p, i) => (i === idx ? frozen : p));
    scene.updateNode(nodeId, { fills: nextFills });
  },

  applyEffectStyleToNode: (nodeId, styleId) => {
    const style = get().effectStyles.find((s) => s.id === styleId);
    if (!style) return;
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node) return;
    scene.updateNode(nodeId, { effectStyleId: styleId });
  },

  applyFillStyleToNode: (nodeId, styleId) => {
    const style = get().fillStyles.find((s) => s.id === styleId);
    if (!style) return;
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node) return;
    const currentFills = getFills(node);
    if (currentFills.length > 0) {
      const topIndex = currentFills.length - 1;
      const nextFills: Paint[] = currentFills.map((p, i) =>
        i === topIndex ? { ...p, styleId } : p,
      );
      scene.updateNode(nodeId, { fills: nextFills, ...clearLegacyFillProps() });
    } else {
      const newPaint: Paint = { ...style.paint, id: generateId(), styleId };
      scene.updateNode(nodeId, { fills: [newPaint], ...clearLegacyFillProps() });
    }
  },

  detachEffectStyleFromNode: (nodeId) => {
    const { effectStyles } = get();
    const scene = useSceneStore.getState();
    const node = scene.nodesById[nodeId];
    if (!node?.effectStyleId) return;
    const style = effectStyles.find((s) => s.id === node.effectStyleId);
    if (!style) {
      // Dangling reference — just clear it, nothing to inline.
      scene.updateNode(nodeId, { effectStyleId: undefined });
      return;
    }
    scene.updateNode(nodeId, {
      effectStyleId: undefined,
      // Freeze each shadow's theme-resolved color (drops any colorBinding).
      effects: style.effects.map((e) => freezeEffectColor(e, nodeId)),
    });
  },
}));
