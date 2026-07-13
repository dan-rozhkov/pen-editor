/**
 * Walk `parentById` up from `id` to its top-level (root) ancestor.
 *
 * Pure — reads no stores, mutates nothing. Shared by `editorModeStore`
 * (present-mode slide indexing) and the Slides-section speaker notes UI
 * (active slide = top-level ancestor of the current selection).
 */
export function topLevelAncestorId(
  parentById: Record<string, string | null>,
  id: string,
): string {
  let cur = id;
  while (parentById[cur]) cur = parentById[cur] as string;
  return cur;
}
