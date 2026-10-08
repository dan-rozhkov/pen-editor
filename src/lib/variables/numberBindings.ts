import type {
  SceneNode,
  FlatSceneNode,
  LayoutProperties,
  NumberBindingKey,
  NumberBindings,
} from "../../types/scene";
import { THEME_COLLECTION_ID } from "../../types/variable";
import type { ModeContext, ModeInput, Variable, VariableCollection, VariableScope } from "../../types/variable";
import { getVariableIndex, type VariableIndex } from "./variableIndex";
import { getVariableValueAt } from "./resolve";
import { getEffectiveModeContext } from "./modeContext";

/**
 * Number bindings on nodes (tokens v2, T1.5).
 *
 * Design: the literal field ALWAYS holds the resolved number, so layout, text
 * measurement, export and the Pixi renderers keep reading plain fields. This
 * module is the pure half: key table, patch computation, and the unbind guard.
 * The reactive half is `src/store/numberBindingSync.ts`.
 */

type AnyNode = Record<string, unknown>;

interface KeySpec {
  /** Where the literal lives: top-level node field, or `node.layout.<key>`. */
  where: "node" | "layout";
  /** Variable scopes that make a variable a sensible target for this key. */
  scopes: readonly VariableScope[];
  min: number;
  max: number;
}

const SPACING: readonly VariableScope[] = ["spacing", "gap"];

export const NUMBER_BINDING_SPECS: Readonly<Record<NumberBindingKey, KeySpec>> = {
  cornerRadius: { where: "node", scopes: ["radius"], min: 0, max: Infinity },
  paddingTop: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  paddingRight: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  paddingBottom: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  paddingLeft: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  gap: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  rowGap: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  columnGap: { where: "layout", scopes: SPACING, min: 0, max: Infinity },
  width: { where: "node", scopes: ["size"], min: 0, max: Infinity },
  height: { where: "node", scopes: ["size"], min: 0, max: Infinity },
  fontSize: { where: "node", scopes: ["fontSize"], min: 1, max: Infinity },
  strokeWidth: { where: "node", scopes: ["strokeWidth"], min: 0, max: Infinity },
  opacity: { where: "node", scopes: ["opacity"], min: 0, max: 1 },
};

export const NUMBER_BINDING_KEYS = Object.keys(NUMBER_BINDING_SPECS) as NumberBindingKey[];

export function isNumberBindingKey(key: string): key is NumberBindingKey {
  return Object.prototype.hasOwnProperty.call(NUMBER_BINDING_SPECS, key);
}

/** The binding keys a `$--var` string may target for a batch_design property. */
export const NUMBER_BINDING_PADDING_KEYS: readonly NumberBindingKey[] = [
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
];

/** Current literal of a bound field (undefined when unset). */
export function readNumberField(node: Pick<FlatSceneNode, "type">, key: NumberBindingKey): number | undefined {
  const rec = node as unknown as AnyNode;
  const raw =
    NUMBER_BINDING_SPECS[key].where === "layout"
      ? (rec.layout as LayoutProperties | undefined)?.[key as keyof LayoutProperties]
      : rec[key];
  return typeof raw === "number" ? raw : undefined;
}

export function clampForKey(key: NumberBindingKey, value: number): number {
  const { min, max } = NUMBER_BINDING_SPECS[key];
  return Math.min(max, Math.max(min, value));
}

/**
 * Whether `key` is bindable on this node right now. `width`/`height` bind only
 * while the sizing mode is `fixed` (otherwise the layout engine owns the size).
 */
export function isKeyActive(node: FlatSceneNode, key: NumberBindingKey): boolean {
  if (key === "width") return (node.sizing?.widthMode ?? "fixed") === "fixed";
  if (key === "height") return (node.sizing?.heightMode ?? "fixed") === "fixed";
  return true;
}

/** Resolve a number variable to a finite number under `input`, else null. */
export function resolveNumberBinding(
  variable: Variable | undefined,
  index: VariableIndex,
  input: ModeInput,
): number | null {
  if (!variable || variable.type !== "number") return null;
  const value = Number(getVariableValueAt(variable, input, index));
  return Number.isFinite(value) ? value : null;
}

/**
 * Pure: the literal patches needed to bring bound fields in line with their
 * variables, each node resolved under its effective mode context (`baseModes`
 * plus ancestor frames' mode overrides). `ids` limits the scan (the sync passes the bound-id set). Returns
 * a patch only where the resolved number differs from the current literal, so
 * a second run over the result is empty (idempotent => no subscribe loop).
 * A binding to a missing / non-number variable is left alone (literal kept).
 */
export function computeBoundNumberPatches(
  nodesById: Readonly<Record<string, FlatSceneNode>>,
  parentById: Readonly<Record<string, string | null>>,
  ids: Iterable<string>,
  variables: readonly Variable[],
  collections: readonly VariableCollection[],
  baseModes: ModeInput,
): Record<string, Partial<FlatSceneNode>> {
  const index = getVariableIndex(variables as Variable[], collections as VariableCollection[]);
  const patches: Record<string, Partial<FlatSceneNode>> = {};
  // A bare string is a Theme-collection mode id (the legacy meaning of `ModeInput`).
  const base: ModeContext = typeof baseModes === "string" ? { [THEME_COLLECTION_ID]: baseModes } : baseModes;
  for (const id of ids) {
    const node = nodesById[id];
    const bindings = node?.numberBindings;
    if (!node || !bindings) continue;
    let modes: ModeContext | undefined;
    let top: AnyNode | undefined;
    let layout: LayoutProperties | undefined;
    for (const key of Object.keys(bindings) as NumberBindingKey[]) {
      const binding = bindings[key];
      if (!binding || !isNumberBindingKey(key) || !isKeyActive(node, key)) continue;
      // The node's effective context: the base plus every ancestor frame's
      // overrides (a frame's own picks affect its descendants, not itself).
      modes ??= getEffectiveModeContext(
        parentById as Record<string, string | null>,
        nodesById as Record<string, { type?: string; modeOverrides?: Record<string, string>; themeOverride?: "light" | "dark" }>,
        id,
        base,
      );
      const resolved = resolveNumberBinding(index.byId.get(binding.variableId), index, modes);
      if (resolved === null) continue;
      const next = clampForKey(key, resolved);
      if (readNumberField(node, key) === next) continue;
      if (NUMBER_BINDING_SPECS[key].where === "layout") {
        layout ??= { ...(node as unknown as { layout?: LayoutProperties }).layout };
        (layout as Record<string, number>)[key] = next;
      } else {
        top ??= {};
        top[key] = next;
      }
    }
    if (top || layout) {
      const patch: AnyNode = { ...top };
      if (layout) patch.layout = layout;
      patches[id] = patch as Partial<FlatSceneNode>;
    }
  }
  return patches;
}

/**
 * The unbind invariant. A literal write to a bound field drops that binding,
 * otherwise the next sync would silently revert a manual edit.
 *
 * `updates` is what the caller asked to write; `updated` the node after the
 * merge. A key counts as written when `updates` touches its field (for layout
 * keys: touches `layout`) AND the literal actually changed. If the caller sets
 * `numberBindings` itself it owns the result (the batch_design mapper does its
 * own pruning). Returns the same object when nothing needs to change.
 */
export function guardNumberBindings<T extends FlatSceneNode>(
  existing: FlatSceneNode,
  updated: T,
  updates: Partial<FlatSceneNode>,
): T {
  const bindings = existing.numberBindings;
  if (!bindings || "numberBindings" in updates) return updated;
  const pruned = pruneNumberBindings(existing, updated, updates);
  if (pruned === bindings) return updated;
  return { ...updated, numberBindings: pruned };
}

/**
 * The bindings of `existing` minus keys that `updates` rewrote with a different
 * literal. Returns `existing.numberBindings` itself when nothing was dropped,
 * `undefined` when nothing is left. `keep` lists keys that must survive (set in
 * the same write).
 */
export function pruneNumberBindings(
  existing: FlatSceneNode,
  updated: FlatSceneNode,
  updates: Partial<FlatSceneNode>,
  keep?: ReadonlySet<string>,
): NumberBindings | undefined {
  const bindings = existing.numberBindings;
  if (!bindings) return undefined;
  const touched = updates as unknown as AnyNode;
  let out: NumberBindings | null = null;
  for (const key of Object.keys(bindings) as NumberBindingKey[]) {
    if (!isNumberBindingKey(key) || keep?.has(key)) continue;
    const field = NUMBER_BINDING_SPECS[key].where === "layout" ? "layout" : key;
    if (!(field in touched)) continue;
    if (readNumberField(existing, key) === readNumberField(updated, key)) continue;
    out ??= { ...bindings };
    delete out[key];
  }
  if (!out) return bindings;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Drop bindings whose variable no longer exists in `variables` (cross-document paste). */
export function dropDanglingNumberBindings(
  node: FlatSceneNode,
  hasVariable: (id: string) => boolean,
): FlatSceneNode {
  const bindings = node.numberBindings;
  if (!bindings) return node;
  const kept: NumberBindings = {};
  let dropped = false;
  for (const key of Object.keys(bindings) as NumberBindingKey[]) {
    const b = bindings[key];
    if (b && hasVariable(b.variableId)) kept[key] = b;
    else dropped = true;
  }
  if (!dropped) return node;
  return { ...node, numberBindings: Object.keys(kept).length > 0 ? kept : undefined };
}

/** Tree version of `dropDanglingNumberBindings` for a pasted `SceneNode` subtree. */
export function dropDanglingNumberBindingsInTree<T extends SceneNode>(
  node: T,
  hasVariable: (id: string) => boolean,
): T {
  const self = dropDanglingNumberBindings(node as unknown as FlatSceneNode, hasVariable) as unknown as T;
  const children = (self as unknown as { children?: SceneNode[] }).children;
  if (!Array.isArray(children)) return self;
  return { ...self, children: children.map((c) => dropDanglingNumberBindingsInTree(c, hasVariable)) };
}
