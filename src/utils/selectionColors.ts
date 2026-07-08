import type { Effect, FlatSceneNode, SceneNode, ShadowEffect } from "@/types/scene";
import { clearLegacyEffectProps, clearLegacyFillProps, getEffects, getFills } from "@/utils/fillUtils";

/**
 * A node this module can walk/aggregate. Accepts both nested `SceneNode`s and
 * the store's flat `FlatSceneNode`s — the walk only touches color-bearing
 * fields + `id`/`type`, never `children` (structure comes from `childrenById`).
 */
type ColorNode = SceneNode | FlatSceneNode;

/**
 * "Selection colors" aggregation (Figma parity): every unique solid color used
 * across a selection and its descendants, surfaced as one swatch per color so
 * editing it remaps every occurrence at once. See
 * `docs/superpowers/specs/2026-07-09-selection-colors-design.md`.
 */
export interface SelectionColor {
  color: string;
  count: number;
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Normalize any hex color string to a canonical uppercase key, expanding
 * 3/4-digit shorthand to 6/8 digits. Returns `null` for anything that isn't a
 * parseable hex color (e.g. a variable reference string, empty string).
 */
export function normalizeColorKey(hex: string): string | null {
  if (typeof hex !== "string") return null;
  const match = HEX_RE.exec(hex.trim());
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3 || digits.length === 4) {
    digits = digits
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${digits.toUpperCase()}`;
}

/**
 * Invoke `onColor` for every solid-color hex field on `node` that isn't
 * bound to a variable. Reused (in mirror form) by `collectSelectionColors`
 * and `remapNodeColorUpdates` so the two stay in lockstep re: which fields
 * count as "a color of this node".
 */
function forEachNodeColor(node: ColorNode, onColor: (hex: string) => void): void {
  for (const paint of getFills(node)) {
    if (paint.type === "solid" && !paint.colorBinding) {
      onColor(paint.color);
    }
  }

  if (!node.strokeBinding) {
    if (node.stroke) onColor(node.stroke);
    if (node.type === "path" && node.pathStroke?.fill) {
      onColor(node.pathStroke.fill);
    }
  }

  for (const effect of getEffects(node)) {
    if (effect.type === "shadow" && !effect.colorBinding) {
      onColor(effect.color);
    }
  }
}

/**
 * Pre-order walk of `roots` and their descendants (roots in given order, then
 * each root's children depth-first, via `childrenById`).
 */
function walkPreOrder(
  roots: ColorNode[],
  nodesById: Record<string, ColorNode>,
  childrenById: Record<string, string[]>,
  visit: (node: ColorNode) => void,
): void {
  function visitNode(node: ColorNode) {
    visit(node);
    for (const childId of childrenById[node.id] ?? []) {
      const child = nodesById[childId];
      if (child) visitNode(child);
    }
  }
  for (const root of roots) visitNode(root);
}

/**
 * Collect every unique solid color used across `roots` and their
 * descendants, skipping variable-bound fields. Order is first-seen during a
 * deterministic pre-order walk (roots in given order, then depth-first
 * descendants).
 */
export function collectSelectionColors(
  roots: ColorNode[],
  nodesById: Record<string, ColorNode>,
  childrenById: Record<string, string[]>,
): SelectionColor[] {
  const order: string[] = [];
  const counts = new Map<string, number>();

  walkPreOrder(roots, nodesById, childrenById, (node) => {
    forEachNodeColor(node, (hex) => {
      const key = normalizeColorKey(hex);
      if (!key) return;
      if (!counts.has(key)) {
        counts.set(key, 0);
        order.push(key);
      }
      counts.set(key, counts.get(key)! + 1);
    });
  });

  return order.map((key) => ({ color: key, count: counts.get(key)! }));
}

/**
 * Build the partial update for a single node that rewrites every matching
 * color field (fills/stroke/pathStroke.fill/effects) from `fromKey` to `to`.
 * Returns `null` when nothing on this node matches.
 */
function remapNodeColorUpdates(
  node: ColorNode,
  fromKey: string,
  to: string,
): Partial<SceneNode> | null {
  let updates: Partial<SceneNode> | null = null;

  // Fills
  const fills = getFills(node);
  let fillsChanged = false;
  const nextFills = fills.map((paint) => {
    if (paint.type === "solid" && !paint.colorBinding && normalizeColorKey(paint.color) === fromKey) {
      fillsChanged = true;
      return { ...paint, color: to };
    }
    return paint;
  });
  if (fillsChanged) {
    updates = {
      ...(updates ?? {}),
      fills: nextFills,
      ...clearLegacyFillProps(),
    } as Partial<SceneNode>;
  }

  // Stroke (node.stroke + path nodes' pathStroke.fill)
  if (!node.strokeBinding) {
    if (node.stroke && normalizeColorKey(node.stroke) === fromKey) {
      updates = { ...(updates ?? {}), stroke: to } as Partial<SceneNode>;
    }
    if (
      node.type === "path" &&
      node.pathStroke?.fill &&
      normalizeColorKey(node.pathStroke.fill) === fromKey
    ) {
      updates = {
        ...(updates ?? {}),
        pathStroke: { ...node.pathStroke, fill: to },
      } as Partial<SceneNode>;
    }
  }

  // Effects (shadow colors)
  const effects = getEffects(node);
  let effectsChanged = false;
  const nextEffects: Effect[] = effects.map((effect) => {
    if (
      effect.type === "shadow" &&
      !effect.colorBinding &&
      normalizeColorKey(effect.color) === fromKey
    ) {
      effectsChanged = true;
      return { ...effect, color: to } as ShadowEffect;
    }
    return effect;
  });
  if (effectsChanged) {
    updates = {
      ...(updates ?? {}),
      effects: nextEffects,
      ...clearLegacyEffectProps(),
    } as Partial<SceneNode>;
  }

  return updates;
}

/**
 * Build a `{ nodeId: Partial<SceneNode> }` batch that rewrites every field
 * whose normalized hex equals `normalizeColorKey(from)` to `to`, across
 * `roots` and their descendants. Nodes with no matching field are omitted
 * from the result.
 */
export function remapSelectionColor(
  roots: ColorNode[],
  nodesById: Record<string, ColorNode>,
  childrenById: Record<string, string[]>,
  from: string,
  to: string,
): Record<string, Partial<SceneNode>> {
  const fromKey = normalizeColorKey(from);
  const result: Record<string, Partial<SceneNode>> = {};
  if (!fromKey) return result;

  walkPreOrder(roots, nodesById, childrenById, (node) => {
    const updates = remapNodeColorUpdates(node, fromKey, to);
    if (updates) result[node.id] = updates;
  });

  return result;
}
