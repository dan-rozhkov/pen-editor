// Shared "is there a valid image-op target?" check for both the toolbar
// buttons (ImageOpsTools.tsx) and the palette commands (imageOpsCommands.ts)
// — a pure function so the two surfaces can never disagree about
// availability, and so it's trivially unit-testable without mounting React
// or touching Zustand stores.
//
// This mirrors the "does this node have an image fill" half of
// `findNodeImagePaint` (src/lib/imageOps/resolveSourceUrl.ts) rather than
// calling it directly: that module is owned by the parallel image-ops work
// (see repo instructions) and its function throws + reads the store by id,
// which doesn't fit a pure, already-selector-scoped check here. The actual
// operation (upload/apply) still runs through that module unchanged.
import type { FlatSceneNode } from "@/types/scene";
import { getFills } from "@/utils/fillUtils";

/**
 * The id of the single selected node with an image fill, or null when zero
 * or more than one node is selected, or the lone selection has no image
 * fill. Both image-op entry points (toolbar buttons, palette commands) are
 * only ever offered for this exact target.
 */
export function resolveImageOpsTargetNodeId(
  nodesById: Record<string, FlatSceneNode>,
  selectedIds: string[],
): string | null {
  if (selectedIds.length !== 1) return null;
  const node = nodesById[selectedIds[0]];
  if (!node) return null;
  const hasImageFill = getFills(node).some((paint) => paint.type === "image");
  return hasImageFill ? node.id : null;
}
