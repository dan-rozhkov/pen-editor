import {
  THEME_COLLECTION_ID,
  type ThemeValues,
  type Variable,
  type VariableCollection,
  type VariableModeValue,
} from "@/types/variable";
import { ensureThemeCollection } from "./collections";
import { resolveVariable } from "./resolve";
import { buildVariableIndex, collectionIdOf, modeValuesOf } from "./variableIndex";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isModeValue(x: unknown): x is VariableModeValue {
  return typeof x === "string" || (isRecord(x) && typeof x.alias === "string");
}

/**
 * Bring any variable shape (v1.0/1.1 `value` / `themeValues`, or v2) to v2.
 * Pure and idempotent; the result is already `finalizeVariables`-ed (mirrors
 * recomputed).
 *
 * - `themeValues` wins over `value` (the old panel kept `value` = dark).
 * - A variable whose collection is unknown is reassigned to Theme, keeping one
 *   literal in both modes: modes of a collection we cannot see mean nothing.
 */
export function upgradeVariablesV2(
  raw: unknown[],
  collections?: VariableCollection[],
): { variables: Variable[]; collections: VariableCollection[] } {
  const outCollections = ensureThemeCollection(collections ?? []);
  const known = new Set(outCollections.map((c) => c.id));
  const variables: Variable[] = [];

  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const v = item as unknown as Variable;
    const hasModes = isRecord(v.valuesByMode) && Object.values(v.valuesByMode).every(isModeValue);
    const cid = v.collectionId;
    if (hasModes && cid !== undefined && known.has(cid)) {
      variables.push(v);
      continue;
    }

    let light: VariableModeValue;
    let dark: VariableModeValue;
    if (v.themeValues && typeof v.themeValues.light === "string" && typeof v.themeValues.dark === "string") {
      light = v.themeValues.light;
      dark = v.themeValues.dark;
    } else if (hasModes) {
      // v2 data in a collection we do not have: keep one literal for both modes.
      const first = Object.values(v.valuesByMode as Record<string, VariableModeValue>).find(
        (e): e is string => typeof e === "string",
      );
      light = dark = first ?? (typeof v.value === "string" ? v.value : "");
    } else {
      light = dark = typeof v.value === "string" ? v.value : "";
    }
    const lightStr = typeof light === "string" ? light : v.value ?? "";
    const darkStr = typeof dark === "string" ? dark : v.value ?? "";
    variables.push({
      ...v,
      collectionId: THEME_COLLECTION_ID,
      valuesByMode: { light, dark },
      value: lightStr,
      themeValues: { light: lightStr, dark: darkStr },
    });
  }
  return { variables: finalizeVariables(variables, outCollections), collections: outCollections };
}

/**
 * Recompute the compat mirrors (`value`, `themeValues`) from `valuesByMode`.
 * A variable keeps its object identity when its mirrors already match, so the
 * rest of the editor (pixi sync, selectors) sees only real changes.
 */
export function finalizeVariables(
  variables: Variable[],
  collections?: VariableCollection[],
): Variable[] {
  const index = buildVariableIndex(variables, collections);
  return variables.map((v) => {
    const own = index.collections.get(collectionIdOf(v));
    const def = own ? { [collectionIdOf(v)]: own.defaultModeId } : {};
    const resolved = resolveVariable(index, v.id, def);
    const value = resolved.ok ? resolved.value : v.value ?? "";

    let themeValues: ThemeValues | undefined;
    if (collectionIdOf(v) === THEME_COLLECTION_ID) {
      const at = (mode: "light" | "dark"): string => {
        const r = resolveVariable(index, v.id, mode);
        if (r.ok) return r.value;
        const lit = modeValuesOf(v)[mode];
        return typeof lit === "string" ? lit : value;
      };
      themeValues = { light: at("light"), dark: at("dark") };
    }

    const sameTheme =
      themeValues === undefined
        ? v.themeValues === undefined
        : v.themeValues?.light === themeValues.light && v.themeValues?.dark === themeValues.dark;
    if (v.value === value && sameTheme && v.collectionId !== undefined && v.valuesByMode !== undefined) return v;

    const next: Variable = {
      ...v,
      collectionId: collectionIdOf(v),
      valuesByMode: modeValuesOf(v),
      value,
    };
    if (themeValues) next.themeValues = themeValues;
    else delete next.themeValues;
    return next;
  });
}

/**
 * Merge `patch` into `prev`. Callers written for the v1 shape
 * (`{ value }`, `{ themeValues }`) still mean "change what the variable
 * shows"; the mirrors are derived from `valuesByMode`, so such an edit is
 * translated into a `valuesByMode` edit or `finalizeVariables` would
 * recompute it away.
 *
 * - `themeValues` (Theme collection only) sets the light and dark literals.
 * - `value` sets the collection's default mode — or both modes of a
 *   single-valued Theme variable, which is what "the one value" meant in v1.
 */
export function patchVariable(
  prev: Variable,
  patch: Partial<Variable>,
  collections: VariableCollection[],
): Variable {
  const merged: Variable = { ...prev, ...patch, collectionId: patch.collectionId ?? collectionIdOf(prev) };
  if (patch.valuesByMode) return merged;
  const modes = modeValuesOf(prev);
  const isTheme = collectionIdOf(prev) === THEME_COLLECTION_ID;
  if (patch.themeValues && isTheme) {
    merged.valuesByMode = { ...modes, light: patch.themeValues.light, dark: patch.themeValues.dark };
  } else if (typeof patch.value === "string" && patch.value !== prev.value) {
    const def = collections.find((c) => c.id === collectionIdOf(prev))?.defaultModeId ?? "light";
    const single = isTheme && typeof modes.light === "string" && modes.light === modes.dark;
    merged.valuesByMode = single
      ? { ...modes, light: patch.value, dark: patch.value }
      : { ...modes, [def]: patch.value };
  } else {
    merged.valuesByMode = modes;
  }
  return merged;
}
