import type { Container } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";
import { resolveMasking } from "@/lib/masks/maskResolution";

/**
 * Apply Figma-style sibling masking to one parent's already-created child
 * containers. Thin Pixi layer over the pure `resolveMasking` logic (see
 * `@/lib/masks/maskResolution`) — mirrors the shaderFillHelpers/
 * patternFillHelpers split so the ordering/mode rules stay unit-testable
 * without ever constructing a real PixiJS container in Vitest.
 *
 * `orderedIds` must be the exact z-order used to build `getContainer` (bottom
 * to top). Every masked sibling gets its masker's container set as `.mask`
 * (cleared to `null` otherwise).
 *
 * A masker's own container is deliberately left alone (`renderable`
 * untouched) when it is actively masking at least one sibling: PixiJS's own
 * mask effect (`StencilMask`/`AlphaMask`, see `effectsMixin`/
 * `StencilMask.init`) already excludes an assigned mask object from normal
 * rendering via `includeInBuild`, and it does this by temporarily flipping
 * `includeInBuild` back on while it collects the mask's own renderables for
 * the stencil/alpha pass. Also setting `renderable = false` ourselves would
 * short-circuit that pass too (`collectRenderables` bails out whenever
 * `globalDisplayStatus` — which folds in `renderable` — drops below its
 * "fully displayable" threshold), silently breaking the mask entirely.
 *
 * A masker with nothing above it to clip (inert — matches Figma, where an
 * unused mask layer still doesn't render its own shape) is never assigned as
 * anyone's `.mask`, so Pixi never hides it — that's the one case this
 * function hides explicitly via `renderable = false`. Any container that is
 * neither a masker nor masked is reset to `renderable = true` / `mask =
 * null`, so toggling `isMask` off (or reordering children) always restores
 * normal rendering.
 */
export function applySiblingMasks(
  orderedIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  getContainer: (id: string) => Container | null | undefined,
): void {
  const { maskerIdBySiblingId, maskerIds } = resolveMasking(orderedIds, nodesById);
  const usedMaskerIds = new Set(maskerIdBySiblingId.values());

  for (const id of orderedIds) {
    const container = getContainer(id);
    if (!container) continue;

    const isInertMasker = maskerIds.has(id) && !usedMaskerIds.has(id);
    container.renderable = !isInertMasker;

    const maskerId = maskerIdBySiblingId.get(id);
    container.mask = maskerId ? (getContainer(maskerId) ?? null) : null;
  }
}
