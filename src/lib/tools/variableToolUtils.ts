import { THEME_COLLECTION_ID } from "@/types/variable";
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

/** The `$id:<variableId>` reference form. */
const ID_REF = /^id:(.+)$/;

/**
 * Resolve a variable reference as the agent writes it. Forms, in order:
 * `$id:<variableId>`; a plain name (`$--x`, `--x`, `x`); and the
 * collection-qualified `$Collection/--x` (collection by name or id), which
 * exists so a name used in two collections can still be chosen. A plain name
 * match always wins, so names that hold a `/` keep working. More than one
 * result means the reference is ambiguous.
 */
export function resolveVariableRef(
  variables: Variable[],
  collections: VariableCollection[],
  ref: string,
): Variable[] {
  const stripped = stripVariableRef(ref);
  const idMatch = ID_REF.exec(stripped);
  if (idMatch) return variables.filter((v) => v.id === idMatch[1].trim());
  const plain = findVariablesByRef(variables, ref);
  if (plain.length > 0) return plain;
  const slash = stripped.indexOf("/");
  if (slash <= 0) return [];
  // Collection names may hold a `/` too: try every split point.
  for (let at = slash; at !== -1; at = stripped.indexOf("/", at + 1)) {
    const collection = findCollection(collections, stripped.slice(0, at));
    if (!collection) continue;
    const inside = variables.filter((v) => (v.collectionId ?? THEME_COLLECTION_ID) === collection.id);
    const hits = findVariablesByRef(inside, stripped.slice(at + 1));
    if (hits.length > 0) return hits;
  }
  return [];
}

/**
 * How `get_variables` writes a reference to `target`: `$name`, or the
 * collection-qualified `$Collection/name` only when the plain name is ambiguous.
 */
export function formatVariableRef(
  variables: Variable[],
  collections: VariableCollection[],
  target: Variable,
): string {
  const name = stripVariableRef(target.name);
  if (findVariablesByRef(variables, target.name).length <= 1) return `$${name}`;
  const cid = target.collectionId ?? THEME_COLLECTION_ID;
  const collection = collections.find((c) => c.id === cid);
  return collection ? `$${collection.name}/${name}` : `$id:${target.id}`;
}
