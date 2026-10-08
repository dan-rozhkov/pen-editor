// Library-owned entities (variables, collections, embed component masters) are
// copies of a linked library's data. The editor treats them as read-only: the
// stores, the tools and the panels all ask this module. Only the link/update
// code writes them, through the bulk setters (`replaceAll`) that skip the guards.
import type { EmbedComponentMeta } from "@/types/scene";
import { toast } from "sonner";
import { useDocumentStore } from "@/store/documentStore";
import { selectComponentRegistry } from "@/store/componentRegistry";

export function isLibraryOwned(item: { libraryId?: string } | null | undefined): boolean {
  return typeof item?.libraryId === "string" && item.libraryId !== "";
}

/** The library's display name from the document's pins; falls back to its id. */
export function libraryLabel(libraryId: string): string {
  return useDocumentStore.getState().libraries.find((p) => p.id === libraryId)?.name ?? libraryId;
}

export type LibraryOwnedKind = "variable" | "collection" | "mode";

/** The one refusal text for an edit of a library-owned variable, collection or mode. */
export function libraryOwnedMessage(kind: LibraryOwnedKind, name: string, libraryId: string): string {
  return `${kind[0].toUpperCase()}${kind.slice(1)} "${name}" is library-owned, read-only (library ${libraryLabel(libraryId)}). Edit it in the library document.`;
}

export const LIBRARY_COMPONENT_MESSAGE = "Library component; edit it in the library document";

export function isLibraryComponent(meta: Pick<EmbedComponentMeta, "library"> | null | undefined): boolean {
  return meta?.library !== undefined;
}

/** A refusal for a write to a library master, or null when the master is local or absent. */
export function libraryComponentError(key: string, meta: Pick<EmbedComponentMeta, "library"> | null | undefined): string | null {
  return isLibraryComponent(meta) ? `Component "${key}": ${LIBRARY_COMPONENT_MESSAGE}.` : null;
}

type MasterLike = { type: string; component?: EmbedComponentMeta; htmlContent?: string };
type NodeMapLike = Record<string, MasterLike | undefined>;

/** The component meta of an embed node, or undefined for any other node. */
function masterMetaOf(node: MasterLike | null | undefined): EmbedComponentMeta | undefined {
  return node?.type === "embed" ? node.component : undefined;
}

/** Structural equality, insensitive to object key order. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.hasOwn(b, k) && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Same master: equal meta (key order ignored) and equal HTML. Geometry and other fields do not count. */
function sameMaster(a: MasterLike, b: MasterLike): boolean {
  return deepEqual(masterMetaOf(a), masterMetaOf(b)) && (a.htmlContent ?? "") === (b.htmlContent ?? "");
}

let libraryWriteDepth = 0;

/**
 * Escape hatch for the library link/update code: inside `fn` the master
 * write guard is off. Synchronous scopes only (the depth counter is reset
 * in `finally`, so an `await` inside would leave the guard on for others).
 */
export function withLibraryWrites<T>(fn: () => T): T {
  libraryWriteDepth++;
  try {
    return fn();
  } finally {
    libraryWriteDepth--;
  }
}

/**
 * A refusal for a scene change (`before` -> `after`, both flat node maps) that
 * would create, alter, duplicate or remove a library master, or that would
 * make a local master claim a key a library master holds. This is the ONE
 * commit-point check: the batch_design commit and the scene-store mutators
 * call it, so no per-operation guard is needed.
 *
 * Only master edits count: a geometry-only change to a local master that
 * already clashes with a library key passes (the clash is reported as drift).
 * `touchedIds` limits the scan to those ids (the store mutators know them);
 * without it every node whose object identity changed is compared.
 */
export function libraryMasterTransitionError(
  before: NodeMapLike,
  after: NodeMapLike,
  touchedIds?: Iterable<string>,
): string | null {
  if (libraryWriteDepth > 0) return null;
  const ids = touchedIds ? [...touchedIds] : [...new Set([...Object.keys(before), ...Object.keys(after)])];

  for (const id of ids) {
    const was = before[id];
    const now = after[id];
    if (was === now) continue;
    const wasMeta = masterMetaOf(was);
    if (was && wasMeta && isLibraryComponent(wasMeta) && (!now || !sameMaster(was, now))) {
      return libraryComponentError(wasMeta.key, wasMeta);
    }
    const nowMeta = masterMetaOf(now);
    if (now && nowMeta && isLibraryComponent(nowMeta) && (!was || !sameMaster(was, now))) {
      return libraryComponentError(nowMeta.key, nowMeta);
    }
  }

  let held: Map<string, EmbedComponentMeta> | null = null;
  for (const id of ids) {
    const was = before[id];
    const now = after[id];
    if (was === now || !now) continue;
    const nowMeta = masterMetaOf(now);
    if (!nowMeta || isLibraryComponent(nowMeta)) continue;
    if (was && sameMaster(was, now)) continue;
    if (!held) {
      held = new Map();
      for (const m of selectComponentRegistry().values()) if (isLibraryComponent(m.meta)) held.set(m.key, m.meta);
      for (const id2 in after) {
        const meta = masterMetaOf(after[id2]);
        if (meta && isLibraryComponent(meta)) held.set(meta.key, meta);
      }
    }
    const clash = held.get(nowMeta.key);
    if (clash) return libraryComponentError(nowMeta.key, clash);
  }
  return null;
}

/**
 * User-action guard for the scene-store mutators: on a refusal it shows a
 * toast and returns false, so the mutator leaves the scene (and history) alone.
 */
export function guardLibraryMasterWrite(before: NodeMapLike, after: NodeMapLike, touchedIds: Iterable<string>): boolean {
  const refusal = libraryMasterTransitionError(before, after, touchedIds);
  if (refusal) toast.error(refusal);
  return !refusal;
}

/** Why `replacement` cannot replace the deprecated variable `target`, or null when it can. */
export function variableReplacementError(
  target: { id: string; name: string; type: string },
  replacement: { id: string; name: string; type: string; libraryId?: string },
): string | null {
  if (replacement.id === target.id) return "A variable cannot replace itself.";
  if (replacement.type !== target.type) {
    return `The replacement has type ${replacement.type}; ${target.name} is ${target.type}.`;
  }
  if (isLibraryOwned(replacement)) {
    return `"${replacement.name}" belongs to another library; a replacement must be in this library.`;
  }
  return null;
}
