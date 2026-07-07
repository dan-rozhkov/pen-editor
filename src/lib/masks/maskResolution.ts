import type { FlatSceneNode } from "@/types/scene";
import { getFills } from "@/utils/fillUtils";

/**
 * Which masking technique a masker node uses (Figma parity, minimum viable:
 * vector + alpha; luminance is not implemented).
 *
 * - "vector": clip by the node's geometric outline (hard edges) — the
 *   default for shape nodes (rect/ellipse/path/polygon/frame/group/line).
 * - "alpha": text nodes, or any node carrying an image paint — clips using
 *   the node's own rendered shape (its container's stencil silhouette),
 *   like "vector" mode. This is a *classification*, not yet a distinct Pixi
 *   render path: true per-pixel alpha/transparency masking (e.g. a PNG's
 *   soft edges, or individual glyph shapes) needs the mask object to be a
 *   literal `Sprite` for PixiJS's `AlphaMask` to engage (see
 *   `pixi.js`'s `effectsMixin`/`AlphaMask.test`); our masker containers wrap
 *   Sprites/Text rather than being one directly, so today they always
 *   resolve to `StencilMask` (bounding-shape clip, current known
 *   limitation — see `pixi/renderers/maskHelpers.ts`).
 */
export type MaskMode = "vector" | "alpha";

/** Determine the masking technique a node would use if `isMask` is set. */
export function getMaskMode(node: FlatSceneNode): MaskMode {
  if (node.type === "text") return "alpha";
  if (getFills(node).some((paint) => paint.type === "image")) return "alpha";
  return "vector";
}

export interface MaskResolution {
  /** Maps a masked sibling's id to the id of the masker node that clips it. */
  maskerIdBySiblingId: Map<string, string>;
  /** Ids of nodes in `orderedIds` that are themselves active maskers. */
  maskerIds: Set<string>;
}

/**
 * Resolve Figma-style sibling masking for one parent's ordered children.
 *
 * `orderedIds` must be in bottom-to-top z-order (the same order used to
 * render children — see `childrenById`/`flattenTree`: index 0 renders first
 * / is at the back, the last index renders last / is on top).
 *
 * A node with `isMask: true` clips every sibling above it (later in the
 * array) up to — but not including — the next masking sibling, or the end
 * of the list. A masker never masks itself, and a masker with nothing above
 * it has no visible effect (matches Figma).
 */
export function resolveMasking(
  orderedIds: string[],
  nodesById: Record<string, FlatSceneNode>,
): MaskResolution {
  const maskerIdBySiblingId = new Map<string, string>();
  const maskerIds = new Set<string>();
  let currentMaskerId: string | null = null;

  for (const id of orderedIds) {
    const node = nodesById[id];
    if (node?.isMask) {
      currentMaskerId = id;
      maskerIds.add(id);
      continue;
    }
    if (currentMaskerId) {
      maskerIdBySiblingId.set(id, currentMaskerId);
    }
  }

  return { maskerIdBySiblingId, maskerIds };
}
