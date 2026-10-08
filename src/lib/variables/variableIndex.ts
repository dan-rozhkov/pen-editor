import {
  THEME_COLLECTION_ID,
  type CollectionId,
  type ModeId,
  type Variable,
  type VariableCollection,
  type VariableId,
  type VariableModeValue,
} from "@/types/variable";
import { ensureThemeCollection } from "./collections";

export interface VariableIndex {
  byId: Map<VariableId, Variable>;
  collections: Map<CollectionId, VariableCollection>;
}

/** The collection a variable belongs to; a legacy variable (no field) is in Theme. */
export function collectionIdOf(variable: Variable): CollectionId {
  return variable.collectionId ?? THEME_COLLECTION_ID;
}

/**
 * The per-mode values of a variable. A legacy-shaped variable (no
 * `valuesByMode`) reads as light/dark from `themeValues`, else from `value`.
 */
export function modeValuesOf(variable: Variable): Record<ModeId, VariableModeValue> {
  if (variable.valuesByMode) return variable.valuesByMode;
  const tv = variable.themeValues;
  return { light: tv?.light ?? variable.value, dark: tv?.dark ?? variable.value };
}

/**
 * Build the lookup. A collection that variables reference but `collections`
 * does not declare (the caller passed none, or the data is stale) is
 * synthesized from the modes its variables use — default = the first one — so
 * a read never throws on missing metadata.
 */
export function buildVariableIndex(
  variables: Variable[],
  collections?: VariableCollection[],
): VariableIndex {
  const byId = new Map<VariableId, Variable>();
  const colls = new Map<CollectionId, VariableCollection>();
  for (const c of ensureThemeCollection(collections ?? [])) colls.set(c.id, c);
  for (const v of variables) {
    byId.set(v.id, v);
    const cid = collectionIdOf(v);
    if (colls.has(cid)) continue;
    const modeIds = Object.keys(modeValuesOf(v));
    if (modeIds.length === 0) continue;
    colls.set(cid, {
      id: cid,
      name: cid,
      modes: modeIds.map((id) => ({ id, name: id })),
      defaultModeId: modeIds[0],
    });
  }
  return { byId, collections: colls };
}

interface IndexSlots {
  /** Keyed by the identity of the `collections` array the caller passed. */
  byCollections: WeakMap<VariableCollection[], VariableIndex>;
  /** The slot for callers that pass no collections. */
  withoutCollections?: VariableIndex;
}

const cache = new WeakMap<Variable[], IndexSlots>();

/**
 * `buildVariableIndex`, cached by the identity of the `variables` array (the
 * store replaces the array on every change, so identity is a sound cache key)
 * and, per variables array, by the identity of `collections` (callers that pass
 * a different `collections` — or none — never evict each other). This is what
 * makes a per-node-per-fill lookup in the Pixi renderers O(1) instead of a
 * linear `find`.
 */
export function getVariableIndex(
  variables: Variable[],
  collections?: VariableCollection[],
): VariableIndex {
  let slots = cache.get(variables);
  if (!slots) {
    slots = { byCollections: new WeakMap() };
    cache.set(variables, slots);
  }
  const hit = collections ? slots.byCollections.get(collections) : slots.withoutCollections;
  if (hit) return hit;
  const index = buildVariableIndex(variables, collections);
  if (collections) slots.byCollections.set(collections, index);
  else slots.withoutCollections = index;
  return index;
}
