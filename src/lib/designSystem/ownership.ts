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
