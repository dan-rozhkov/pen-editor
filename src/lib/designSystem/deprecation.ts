// Deprecation authoring: the actions behind the "Deprecate..." UI for tokens
// and components. A removal in a later release is allowed only when the entity
// was deprecated first with a replacement or a note (spec section 4), so these
// helpers validate `replacedBy` the way the server will, and `since` is filled
// at publish time with the version being published.
import type { EmbedComponentMeta } from "@/types/scene";
import { useVariableStore } from "@/store/variableStore";
import { selectComponentRegistry, findWinningMaster } from "@/store/componentRegistry";
import { upsertMasterNode } from "@/store/componentOps";
import { isLibraryComponent, isLibraryOwned, libraryComponentError, libraryOwnedMessage, variableReplacementError } from "./ownership";
import type { Snapshot, SnapshotDeprecation } from "./types";

export interface DeprecationInput {
  note?: string;
  /** Variable id (tokens) or component key (components). */
  replacedBy?: string;
}

export type DeprecationResult = { ok: true; warning?: string } | { error: string };

const NO_REASON_WARNING =
  "Deprecated without a replacement or a note: it cannot be removed in a later release until one is added.";

function clean(input: DeprecationInput, since: string | undefined): SnapshotDeprecation {
  const note = input.note?.trim();
  return {
    ...(since ? { since } : {}),
    ...(input.replacedBy ? { replacedBy: input.replacedBy } : {}),
    ...(note ? { note } : {}),
  };
}

export function deprecateVariable(id: string, input: DeprecationInput = {}): DeprecationResult {
  const store = useVariableStore.getState();
  const target = store.variables.find((v) => v.id === id);
  if (!target) return { error: `Variable not found: ${id}` };
  if (isLibraryOwned(target)) return { error: libraryOwnedMessage("variable", target.name, target.libraryId as string) };
  if (input.replacedBy !== undefined) {
    const replacement = store.variables.find((v) => v.id === input.replacedBy);
    if (!replacement) return { error: `Replacement not found: ${input.replacedBy}` };
    const refusal = variableReplacementError(target, replacement);
    if (refusal) return { error: refusal };
  }
  const deprecated = clean(input, target.deprecated?.since);
  if (!store.updateVariable(id, { deprecated })) return { error: "Deprecation refused" };
  return deprecated.replacedBy || deprecated.note ? { ok: true } : { ok: true, warning: NO_REASON_WARNING };
}

export function undeprecateVariable(id: string): DeprecationResult {
  const store = useVariableStore.getState();
  const target = store.variables.find((v) => v.id === id);
  if (!target) return { error: `Variable not found: ${id}` };
  if (!store.updateVariable(id, { deprecated: undefined })) return { error: "Un-deprecate refused" };
  return { ok: true };
}

function setComponentDeprecation(key: string, deprecated: EmbedComponentMeta["deprecated"]): DeprecationResult {
  const found = findWinningMaster(key);
  if (!found) return { error: `Component "${key}" not found` };
  const refusal = libraryComponentError(key, found.node.component);
  if (refusal) return { error: refusal };
  const { deprecated: _old, ...rest } = found.master.meta;
  void _old;
  upsertMasterNode({ meta: deprecated ? { ...rest, deprecated } : rest, html: found.master.html });
  return { ok: true };
}

export function deprecateComponent(key: string, input: DeprecationInput = {}): DeprecationResult {
  const registry = selectComponentRegistry();
  const target = registry.get(key);
  if (!target) return { error: `Component "${key}" not found` };
  if (input.replacedBy !== undefined) {
    const replacement = registry.get(input.replacedBy);
    if (!replacement) return { error: `Replacement not found: ${input.replacedBy}` };
    if (replacement.key === key) return { error: "A component cannot replace itself." };
    if (isLibraryComponent(replacement.meta)) {
      return { error: `"${replacement.meta.name}" belongs to another library; a replacement must be in this library.` };
    }
  }
  const deprecated = clean(input, target.meta.deprecated?.since);
  const result = setComponentDeprecation(key, deprecated);
  if ("error" in result) return result;
  return deprecated.replacedBy || deprecated.note ? { ok: true } : { ok: true, warning: NO_REASON_WARNING };
}

export function undeprecateComponent(key: string): DeprecationResult {
  return setComponentDeprecation(key, undefined);
}

/** Fills `deprecated.since` on every deprecated entity that has none. Returns a new snapshot. */
export function stampDeprecationSince(snapshot: Snapshot, version: string): Snapshot {
  const stamp = <T extends { deprecated?: SnapshotDeprecation }>(item: T): T =>
    item.deprecated && !item.deprecated.since ? { ...item, deprecated: { ...item.deprecated, since: version } } : item;
  return {
    ...snapshot,
    variables: snapshot.variables.map(stamp),
    components: snapshot.components.map((c) => ({ ...c, meta: stamp(c.meta) })),
  };
}

/**
 * Writes the same `since` back into the open document, so the next publish
 * diffs equal instead of seeing "deprecation details changed". Skips
 * library-owned items. Returns how many entities were stamped.
 */
export function applyDeprecationSince(version: string): number {
  let stamped = 0;
  const store = useVariableStore.getState();
  const variables = store.variables.map((v) => {
    if (isLibraryOwned(v) || !v.deprecated || v.deprecated.since) return v;
    stamped++;
    return { ...v, deprecated: { ...v.deprecated, since: version } };
  });
  if (stamped > 0) store.replaceAll(variables, store.collections);
  for (const master of selectComponentRegistry().values()) {
    const d = master.meta.deprecated;
    if (!d || d.since || isLibraryComponent(master.meta)) continue;
    upsertMasterNode({ meta: { ...master.meta, deprecated: { ...d, since: version } }, html: master.html });
    stamped++;
  }
  return stamped;
}
