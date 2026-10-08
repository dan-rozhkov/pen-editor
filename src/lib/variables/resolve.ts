import {
  THEME_COLLECTION_ID,
  type CollectionId,
  type ModeContext,
  type ModeId,
  type ModeInput,
  type Variable,
  type VariableId,
  type VariableType,
} from "@/types/variable";
import {
  buildVariableIndex,
  collectionIdOf,
  modeValuesOf,
  type VariableIndex,
} from "./variableIndex";

export const MAX_ALIAS_DEPTH = 32;

export type ResolveResult =
  | { ok: true; value: string; modeId: ModeId; chain: VariableId[] }
  | { ok: false; reason: "missing" | "cycle" | "type-mismatch" | "depth"; chain: VariableId[] };

/** A bare string is a mode id of the Theme collection (the legacy meaning). */
export function toModeContext(input: ModeInput): ModeContext {
  return typeof input === "string" ? { [THEME_COLLECTION_ID]: input } : input;
}

/** The mode a collection shows under `input`; unknown or absent = the collection default. */
export function resolveModeId(
  index: VariableIndex,
  collectionId: CollectionId,
  input: ModeInput,
): ModeId {
  const collection = index.collections.get(collectionId);
  const picked = toModeContext(input)[collectionId];
  if (picked !== undefined && (!collection || collection.modes.some((m) => m.id === picked))) {
    return picked;
  }
  return collection?.defaultModeId ?? picked ?? "";
}

export function resolveVariable(
  index: VariableIndex,
  id: VariableId,
  input: ModeInput,
): ResolveResult {
  const ctx = toModeContext(input);
  const chain: VariableId[] = [];
  const seen = new Set<VariableId>();
  let currentId = id;
  let expectedType: VariableType | undefined;

  for (;;) {
    const variable = index.byId.get(currentId);
    if (!variable) return { ok: false, reason: "missing", chain };
    if (expectedType !== undefined && variable.type !== expectedType) {
      return { ok: false, reason: "type-mismatch", chain: [...chain, currentId] };
    }
    if (seen.has(currentId)) return { ok: false, reason: "cycle", chain: [...chain, currentId] };
    if (chain.length >= MAX_ALIAS_DEPTH) return { ok: false, reason: "depth", chain };
    seen.add(currentId);
    chain.push(currentId);
    expectedType = variable.type;

    const values = modeValuesOf(variable);
    const collection = index.collections.get(collectionIdOf(variable));
    const modeId = resolveModeId(index, collectionIdOf(variable), ctx);
    let entry = values[modeId];
    let usedMode = modeId;
    if (entry === undefined && collection) {
      entry = values[collection.defaultModeId];
      usedMode = collection.defaultModeId;
    }
    if (entry === undefined) return { ok: false, reason: "missing", chain };
    if (typeof entry === "string") return { ok: true, value: entry, modeId: usedMode, chain };
    currentId = entry.alias;
  }
}

const TYPE_DEFAULTS: Record<VariableType, string> = { color: "#000000", number: "0", string: "" };

/**
 * The value of `variable` under `input`. Never throws: if resolution fails
 * (cycle, missing target...) it degrades to the variable's own mirror, then to
 * the type's neutral default, so a render path always gets something drawable.
 */
export function getVariableValueAt(
  variable: Variable,
  input: ModeInput,
  index?: VariableIndex,
): string {
  const idx = index ?? buildVariableIndex([variable]);
  const result = resolveVariable(idx, variable.id, input);
  if (result.ok) return result.value;
  return variable.value || TYPE_DEFAULTS[variable.type];
}
