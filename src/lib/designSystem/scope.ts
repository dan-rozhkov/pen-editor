import type { DesignSystemScope } from "@/types/designSystemScope";
import type { CollectionId, VariableCollection } from "@/types/variable";
import { findCollection } from "@/lib/tools/variableToolUtils";
import type { AppliedScope, ComponentStatus, DesignSystemScopeArgs } from "./types";

const MAX_GLOB_LENGTH = 200;

/**
 * `*` and `?` globs, case-insensitive, whole-string. A backslash before `*`, `?` or
 * another backslash makes it literal. Every other character is literal too.
 */
export function globToRegExp(glob: string): RegExp {
  const text = glob.slice(0, MAX_GLOB_LENGTH);
  let body = "";
  for (let i = 0; i < text.length; i++) {
    let ch = text[i];
    if (ch === "\\" && (text[i + 1] === "*" || text[i + 1] === "?" || text[i + 1] === "\\")) {
      ch = text[++i];
      body += ch.replace(/[.+^${}()|[\]\\/*?-]/g, "\\$&");
    } else if (ch === "*") body += ".*";
    else if (ch === "?") body += ".";
    else body += ch.replace(/[.+^${}()|[\]\\/-]/g, "\\$&");
  }
  return new RegExp(`^${body}$`, "i");
}

/** A matcher for a glob list: true when any glob matches any of the texts. Null for an empty list (no filter). */
export function globMatcher(globs: string[] | undefined): ((...texts: string[]) => boolean) | null {
  if (!globs || globs.length === 0) return null;
  const regexps = globs.map(globToRegExp);
  return (...texts) => texts.some((t) => regexps.some((re) => re.test(t)));
}

/** Escape `*`, `?` and `\\` so a query is matched literally by a glob. */
export function escapeGlob(text: string): string {
  return text.replace(/[*?\\]/g, "\\$&");
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

/** Both lists present: only the values in both. One present: that list. Neither: undefined. */
function intersect<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (!a) return b;
  if (!b) return a;
  const inB = new Set(b);
  return a.filter((x) => inB.has(x));
}

/**
 * Merge a saved scope with the explicit filters. An explicit filter only
 * narrows the saved scope: lists are intersected, and a name must match both
 * glob lists. A field one side leaves out comes from the other.
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

  const resolveRefs = (refs: string[] | undefined): CollectionId[] | undefined => {
    if (!refs) return undefined;
    const ids: CollectionId[] = [];
    for (const ref of refs) {
      const hit = findCollection(collections, ref);
      if (!hit) {
        hints.push(`No collection matches "${ref}". Collections: ${collections.map((c) => c.name).join(", ")}.`);
        continue;
      }
      if (!ids.includes(hit.id)) ids.push(hit.id);
    }
    return ids;
  };
  const explicitIds = resolveRefs(nonEmpty(args?.collections));
  const savedIds = resolveRefs(nonEmpty(saved?.collections));
  const keptIds = intersect(explicitIds, savedIds);
  const collectionIds: Set<CollectionId> | null = keptIds ? new Set(keptIds) : null;
  const collectionNames = keptIds?.map((id) => collections.find((c) => c.id === id)?.name ?? id);

  const modes = new Map<CollectionId, Set<string>>();
  for (const [cid, ids] of Object.entries(saved?.modes ?? {})) {
    if (ids.length > 0) modes.set(cid, new Set(ids));
  }

  const componentKeys = intersect(nonEmpty(args?.components), nonEmpty(saved?.components?.keys));
  const componentStatus = intersect(nonEmpty(args?.componentStatus), nonEmpty(saved?.components?.status));
  const tokenScopes = intersect(nonEmpty(args?.tokenScopes), nonEmpty(saved?.tokenScopes));
  const explicitNames = nonEmpty(args?.names);
  const savedNames = nonEmpty(saved?.names);
  const names = explicitNames && savedNames ? [...savedNames, ...explicitNames] : (explicitNames ?? savedNames);
  const matchers = [globMatcher(savedNames), globMatcher(explicitNames)].filter((m) => m !== null);

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
    names: matchers.length > 0 ? (...texts) => matchers.every((m) => m(...texts)) : null,
    hints,
  };
}
