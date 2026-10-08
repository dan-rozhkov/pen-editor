import {
  THEME_COLLECTION_ID,
  type ModeId,
  type Variable,
  type VariableCollection,
  type VariableModeValue,
} from "@/types/variable";
import { wouldCreateCycle } from "./aliasGraph";
import { patchVariable } from "./migrate";
import { resolveVariable } from "./resolve";
import { buildVariableIndex, collectionIdOf, modeValuesOf } from "./variableIndex";

/**
 * Move `variable` into `target`: every mode of the target gets the value the
 * variable resolves to today (its old modes mean nothing there).
 */
export function remapToCollection(
  variables: Variable[],
  collections: VariableCollection[],
  variable: Variable,
  target: VariableCollection,
): Variable {
  const index = buildVariableIndex(variables, collections);
  const resolved = resolveVariable(index, variable.id, {});
  const seed = resolved.ok ? resolved.value : variable.value;
  const valuesByMode: Record<ModeId, VariableModeValue> = {};
  for (const m of target.modes) valuesByMode[m.id] = seed;
  const moved: Variable = { ...variable, collectionId: target.id, valuesByMode };
  if (target.id !== THEME_COLLECTION_ID) delete moved.themeValues;
  return moved;
}

/**
 * Apply `patch` to the variable `id` with the same checks `setVariableModeValue`
 * and `moveVariableToCollection` enforce. Returns the patched variable (mirrors
 * not yet recomputed — run `finalizeVariables`) or `null` when the patch is
 * refused:
 * - unknown variable or target collection;
 * - a `valuesByMode` entry for a mode the collection does not have, an alias to
 *   a missing or other-typed variable, or an alias that closes a cycle;
 * - a `type` change that contradicts the variable's own alias targets or the
 *   type of a variable that aliases it.
 */
export function applyVariablePatch(
  variables: Variable[],
  collections: VariableCollection[],
  id: string,
  patch: Partial<Variable>,
): Variable | null {
  const prev = variables.find((v) => v.id === id);
  if (!prev) return null;

  let base = prev;
  let rest = patch;
  if (patch.collectionId !== undefined) {
    const { collectionId: nextCollection, ...others } = patch;
    rest = others;
    if (nextCollection !== collectionIdOf(prev)) {
      const target = collections.find((c) => c.id === nextCollection);
      if (!target) return null;
      base = remapToCollection(variables, collections, prev, target);
    }
  }

  const next = patchVariable(base, rest, collections);
  const index = buildVariableIndex(variables, collections);
  const collection = index.collections.get(collectionIdOf(next));

  if (rest.valuesByMode) {
    for (const [modeId, entry] of Object.entries(next.valuesByMode ?? {})) {
      if (collection && !collection.modes.some((m) => m.id === modeId)) return null;
      if (typeof entry === "string") continue;
      const aliased = index.byId.get(entry.alias);
      if (!aliased || aliased.type !== next.type) return null;
      if (wouldCreateCycle(index, id, entry.alias)) return null;
    }
  }

  if (next.type !== prev.type) {
    for (const entry of Object.values(modeValuesOf(next))) {
      if (typeof entry === "string") continue;
      if (index.byId.get(entry.alias)?.type !== next.type) return null;
    }
    for (const holder of index.byId.values()) {
      if (holder.type === next.type) continue;
      const aliasesIt = Object.values(modeValuesOf(holder)).some(
        (e) => typeof e !== "string" && e.alias === id,
      );
      if (aliasesIt) return null;
    }
  }
  return next;
}
