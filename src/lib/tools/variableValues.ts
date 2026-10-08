import {
  THEME_COLLECTION_ID,
  type ModeContext,
  type Variable,
  type VariableCollection,
} from "@/types/variable";
import { collectionIdOf, modeValuesOf, resolveVariable, type VariableIndex } from "@/lib/variables";
import { findCollection, findMode, formatVariableRef } from "./variableToolUtils";

export interface ModeArg {
  /** One mode id per collection id. */
  picks: ModeContext;
  hints: string[];
}

/** `mode`: a string is a Theme mode; an object maps collection names to mode names. */
export function readModeArg(mode: unknown, collections: VariableCollection[]): ModeArg {
  const picks: ModeContext = {};
  const hints: string[] = [];
  if (typeof mode === "string" && mode.trim() !== "") {
    const theme = collections.find((c) => c.id === THEME_COLLECTION_ID);
    const hit = theme ? findMode(theme, mode) : undefined;
    if (theme && hit) picks[theme.id] = hit.id;
    else hints.push(`No Theme mode matches "${mode}".`);
  } else if (mode && typeof mode === "object" && !Array.isArray(mode)) {
    for (const [collectionRef, modeRef] of Object.entries(mode as Record<string, unknown>)) {
      const collection = findCollection(collections, collectionRef);
      const hit = collection && typeof modeRef === "string" ? findMode(collection, modeRef) : undefined;
      if (collection && hit) picks[collection.id] = hit.id;
      else hints.push(`No mode matches ${collectionRef}: ${String(modeRef)}.`);
    }
  }
  return { picks, hints };
}

export interface ModeValue {
  raw: string;
  /** Null, with an `error` reason, when the alias chain does not resolve. */
  resolved: string | null;
  error?: string;
}

/**
 * Per mode name: the raw entry and the value resolved under `ctx`, with the
 * listed mode swapped in for its own collection. `modeFilter` limits the modes.
 * Both get_variables and get_design_system report values through this.
 */
export function describeModeValues(
  v: Variable,
  collection: VariableCollection | undefined,
  ctx: ModeContext,
  modeFilter: Set<string> | string | undefined,
  index: VariableIndex,
  variables: Variable[],
  allCollections: VariableCollection[],
): Record<string, ModeValue> {
  const raw = modeValuesOf(v);
  const cid = collectionIdOf(v);
  const values: Record<string, ModeValue> = {};
  for (const mode of collection?.modes ?? []) {
    if (typeof modeFilter === "string" ? mode.id !== modeFilter : modeFilter && !modeFilter.has(mode.id)) continue;
    const entry = raw[mode.id];
    if (entry === undefined) continue;
    const resolved = resolveVariable(index, v.id, { ...ctx, [cid]: mode.id });
    const target = typeof entry === "string" ? undefined : index.byId.get(entry.alias);
    values[mode.name] = {
      raw: typeof entry === "string" ? entry : target ? formatVariableRef(variables, allCollections, target) : `$${entry.alias}`,
      resolved: resolved.ok ? resolved.value : null,
      ...(resolved.ok ? {} : { error: resolved.reason }),
    };
  }
  return values;
}
