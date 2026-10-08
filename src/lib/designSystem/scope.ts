import type { DesignSystemScope } from "@/types/designSystemScope";
import type { CollectionId, VariableCollection } from "@/types/variable";
import { findCollection } from "@/lib/tools/variableToolUtils";
import type { AppliedScope, ComponentStatus, DesignSystemScopeArgs } from "./types";

const MAX_GLOB_LENGTH = 200;

/** `*` and `?` globs, case-insensitive, whole-string. Every other character is literal. */
export function globToRegExp(glob: string): RegExp {
  const body = glob
    .slice(0, MAX_GLOB_LENGTH)
    .split("")
    .map((ch) => (ch === "*" ? ".*" : ch === "?" ? "." : ch.replace(/[.+^${}()|[\]\\/-]/g, "\\$&")))
    .join("");
  return new RegExp(`^${body}$`, "i");
}

/** A matcher for a glob list: true when any glob matches any of the texts. Null for an empty list (no filter). */
export function globMatcher(globs: string[] | undefined): ((...texts: string[]) => boolean) | null {
  if (!globs || globs.length === 0) return null;
  const regexps = globs.map(globToRegExp);
  return (...texts) => texts.some((t) => regexps.some((re) => re.test(t)));
}

/** A saved scope by id, else by name (ignoring case). */
export function findSavedScope(scopes: DesignSystemScope[], ref: string): DesignSystemScope | undefined {
  const trimmed = ref.trim();
  const lower = trimmed.toLowerCase();
  return scopes.find((s) => s.id === trimmed) ?? scopes.find((s) => s.name.trim().toLowerCase() === lower);
}

export interface ResolvedScope {
  saved: DesignSystemScope | null;
  applied: AppliedScope;
  /** Collection ids to keep; null = all. */
  collectionIds: Set<CollectionId> | null;
  /** Per collection id: the mode ids whose values are listed. */
  modes: Map<CollectionId, Set<string>>;
  componentKeys: Set<string> | null;
  componentStatus: Set<ComponentStatus> | null;
  tokenScopes: Set<string> | null;
  names: ((...texts: string[]) => boolean) | null;
  hints: string[];
}

const nonEmpty = <T>(list: T[] | undefined): T[] | undefined => (list && list.length > 0 ? list : undefined);

/**
 * Merge a saved scope with the explicit filters. An explicit field replaces the
 * same field of the saved scope; fields it leaves out come from the saved one.
 */
export function resolveScope(
  collections: VariableCollection[],
  savedScopes: DesignSystemScope[],
  args: DesignSystemScopeArgs | undefined,
): ResolvedScope {
  const hints: string[] = [];
  let saved: DesignSystemScope | null = null;
  if (args?.saved !== undefined && args.saved.trim() !== "") {
    saved = findSavedScope(savedScopes, args.saved) ?? null;
    if (!saved) {
      const names = savedScopes.map((s) => s.name).join(", ");
      hints.push(`No saved scope matches "${args.saved}". Saved scopes: ${names || "none"}.`);
    }
  }

  const collectionRefs = nonEmpty(args?.collections) ?? nonEmpty(saved?.collections);
  let collectionIds: Set<CollectionId> | null = null;
  let collectionNames: string[] | undefined;
  if (collectionRefs) {
    collectionIds = new Set();
    collectionNames = [];
    for (const ref of collectionRefs) {
      const hit = findCollection(collections, ref);
      if (!hit) {
        hints.push(`No collection matches "${ref}". Collections: ${collections.map((c) => c.name).join(", ")}.`);
        continue;
      }
      collectionIds.add(hit.id);
      collectionNames.push(hit.name);
    }
  }

  const modes = new Map<CollectionId, Set<string>>();
  for (const [cid, ids] of Object.entries(saved?.modes ?? {})) {
    if (ids.length > 0) modes.set(cid, new Set(ids));
  }

  const componentKeys = nonEmpty(args?.components) ?? nonEmpty(saved?.components?.keys);
  const componentStatus = nonEmpty(args?.componentStatus) ?? nonEmpty(saved?.components?.status);
  const tokenScopes = nonEmpty(args?.tokenScopes) ?? nonEmpty(saved?.tokenScopes);
  const names = nonEmpty(args?.names) ?? nonEmpty(saved?.names);

  const applied: AppliedScope = {
    ...(collectionNames ? { collections: collectionNames } : {}),
    ...(modes.size > 0 ? { modes: Object.fromEntries([...modes].map(([k, v]) => [k, [...v]])) } : {}),
    ...(componentKeys ? { components: componentKeys } : {}),
    ...(componentStatus ? { componentStatus } : {}),
    ...(tokenScopes ? { tokenScopes } : {}),
    ...(names ? { names } : {}),
  };

  return {
    saved,
    applied,
    collectionIds,
    modes,
    componentKeys: componentKeys ? new Set(componentKeys) : null,
    componentStatus: componentStatus ? new Set(componentStatus) : null,
    tokenScopes: tokenScopes ? new Set(tokenScopes) : null,
    names: globMatcher(names),
    hints,
  };
}
