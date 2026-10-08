// Library-owned entities (variables, collections, embed component masters) are
// copies of a linked library's data. The editor treats them as read-only: the
// stores, the tools and the panels all ask this module. Only the link/update
// code writes them, through the bulk setters (`replaceAll`) that skip the guards.
import type { EmbedComponentMeta } from "@/types/scene";
import { useDocumentStore } from "@/store/documentStore";

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

/** The component meta of an embed node, or undefined for any other node. */
function masterMetaOf(node: { type: string; component?: EmbedComponentMeta } | null | undefined): EmbedComponentMeta | undefined {
  return node?.type === "embed" ? node.component : undefined;
}

/**
 * A refusal for a scene write that would create, alter or remove a library
 * master, or that would create a local master on a key a library master holds.
 * `prev` is the node before the write (absent for a new node), `next` the node
 * after (absent for a delete). `held` is the registry master that owns the key.
 */
export function libraryMasterWriteError(
  prev: { type: string; component?: EmbedComponentMeta } | null | undefined,
  next: { type: string; component?: EmbedComponentMeta } | null | undefined,
  held: { meta: Pick<EmbedComponentMeta, "library"> } | undefined,
): string | null {
  const before = masterMetaOf(prev);
  const after = masterMetaOf(next);
  if (before && isLibraryComponent(before)) {
    if (!after || JSON.stringify(before) !== JSON.stringify(after)) return libraryComponentError(before.key, before);
    return null;
  }
  if (after && isLibraryComponent(after)) return libraryComponentError(after.key, after);
  if (after && held && isLibraryComponent(held.meta)) return libraryComponentError(after.key, held.meta);
  return null;
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
