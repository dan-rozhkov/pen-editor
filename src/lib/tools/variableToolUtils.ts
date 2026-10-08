import type {
  Variable,
  VariableCollection,
  VariableMode,
  VariableScope,
} from "@/types/variable";

export const VARIABLE_SCOPES: readonly VariableScope[] = [
  "fill",
  "stroke",
  "text",
  "radius",
  "spacing",
  "gap",
  "size",
  "fontSize",
  "fontFamily",
  "fontWeight",
  "opacity",
  "strokeWidth",
];

/** A variable reference as the agent writes it: `$--x`, `--x` or `x`. */
export function stripVariableRef(ref: string): string {
  return ref.trim().replace(/^\$/, "");
}

/** Loose key for matching names: no `$`, no `--`, `_` as `-`, lowercase. */
export function variableToken(ref: string): string {
  return stripVariableRef(ref).replace(/^--/, "").replace(/_/g, "-").toLowerCase();
}

/**
 * Find variables by a reference. An exact name match wins; otherwise the loose
 * token match. More than one result means the reference is ambiguous.
 */
export function findVariablesByRef(variables: Variable[], ref: string): Variable[] {
  const exact = stripVariableRef(ref);
  const hits = variables.filter((v) => stripVariableRef(v.name) === exact);
  if (hits.length > 0) return hits;
  const token = variableToken(ref);
  return variables.filter((v) => variableToken(v.name) === token);
}

/** A collection by id or by name (ignoring case). */
export function findCollection(
  collections: VariableCollection[],
  ref: string,
): VariableCollection | undefined {
  const lower = ref.trim().toLowerCase();
  return (
    collections.find((c) => c.id === ref.trim()) ??
    collections.find((c) => c.name.trim().toLowerCase() === lower)
  );
}

/** A mode of a collection by id or by name (ignoring case). */
export function findMode(collection: VariableCollection, ref: string): VariableMode | undefined {
  const lower = ref.trim().toLowerCase();
  return (
    collection.modes.find((m) => m.id === ref.trim()) ??
    collection.modes.find((m) => m.name.trim().toLowerCase() === lower) ??
    collection.modes.find((m) => m.id.toLowerCase() === lower)
  );
}
