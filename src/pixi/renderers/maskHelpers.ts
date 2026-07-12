import { Sprite, type Container } from "pixi.js";
import type { FlatSceneNode } from "@/types/scene";
import { resolveMasking, getMaskMode } from "@/lib/masks/maskResolution";

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
 * neither a masker nor masked is reset to `renderable = true`, so toggling
 * `isMask` off (or reordering children) always restores normal rendering.
 *
 * `.mask` ownership: a node's own container may already carry a `.mask` set
 * by its renderer for an unrelated reason. Legacy frame containers used a
 * direct child labeled `"frame-mask"`; current frames apply that mask to
 * `"frame-children"` so their own background and outer shadow stay visible.
 * PixiJS only supports one `.mask` per container, so when a sibling masker
 * applies to a clipped frame, the sibling mask *wins* and the frame's own
 * clip is temporarily suppressed for as long as it's masked (matches how an
 * alpha-mode masker's own render is likewise approximated — see
 * `maskResolution.ts`). When no sibling masker applies, this function
 * restores the node's own clip mask (if any) instead of unconditionally
 * clearing `.mask` to `null` — the previous behavior stole `.mask` ownership
 * from every clipped frame on every rebuild/reorder, silently breaking
 * `clip: true` for any frame with siblings.
 *
 * Alpha-mode maskers (`getMaskMode` — text or image-fill nodes): PixiJS only
 * engages true per-pixel `AlphaMask` when the mask object is a literal
 * `Sprite` (`AlphaMask.test`, `pixi.js`'s mask-effect dispatch) — anything
 * else falls back to `StencilMask` (a hard silhouette/bbox clip, no soft
 * edges). An image-fill node's container wraps its image in a child
 * labeled `"image-fill"` (see `imageFillHelpers.ts`) which *is* a `Sprite`,
 * so when the masker resolves to that shape, we hand Pixi that Sprite
 * directly instead of the wrapping container — real per-pixel alpha
 * masking for image maskers. Text nodes have no equivalent: PixiJS `Text`
 * is not a `Sprite` subclass, and turning one into a texture sprite here
 * would mean restructuring `textRenderer.ts` — out of scope for this pass,
 * so a text masker still falls back to the container's stencil silhouette
 * (bbox-like clip, current known limitation).
 *
 * Perf: resolving/clearing masking touches every sibling's container via
 * `getContainer` (typically a `getChildByLabel` scan), which is O(children)
 * per call — O(children²) if done for every sibling on every host on every
 * sync. The overwhelmingly common case is a host with no masks at all, so
 * `hostsWithActiveMasking` remembers (by container identity) which hosts
 * have ever had an active masker; when the optional `host` container is
 * passed and it has never had one, a zero-masker call is a true O(1)
 * no-op — no `getContainer` calls at all. Callers that don't pass `host`
 * still get a correct (if less optimal) cleanup pass.
 */
const hostsWithActiveMasking = new WeakSet<Container>();

function getOwnContainerMask(container: Container): Container | null {
  const clip = container.getChildByLabel("frame-mask") as Container | null;
  if (!clip) return null;
  const frameChildren = container.getChildByLabel("frame-children") as Container | null;
  // Frame clipping belongs to its child-content container so the frame's own
  // background and outer shadow remain visible. It is not a mask to restore
  // onto the frame container after sibling masking changes.
  return frameChildren?.mask === clip ? null : clip;
}

/**
 * Resolve the actual Pixi object to assign as `.mask` for a given masker
 * node. Prefers an image-fill masker's own `"image-fill"` Sprite child (true
 * per-pixel `AlphaMask`) over its wrapping container (bbox-like
 * `StencilMask`) — see the module doc comment above.
 */
function resolveMaskTarget(
  maskerId: string,
  nodesById: Record<string, FlatSceneNode>,
  getContainer: (id: string) => Container | null | undefined,
): Container | null {
  const maskerContainer = getContainer(maskerId);
  if (!maskerContainer) return null;

  const maskerNode = nodesById[maskerId];
  if (maskerNode && getMaskMode(maskerNode) === "alpha") {
    const spriteChild = maskerContainer.getChildByLabel("image-fill");
    if (spriteChild instanceof Sprite) return spriteChild;
  }

  return maskerContainer;
}

export function applySiblingMasks(
  orderedIds: string[],
  nodesById: Record<string, FlatSceneNode>,
  getContainer: (id: string) => Container | null | undefined,
  host?: Container,
): void {
  const { maskerIdBySiblingId, maskerIds } = resolveMasking(orderedIds, nodesById);

  if (maskerIds.size === 0) {
    // Nothing here masks anything now. If this exact host container never
    // had active masking applied, its containers are already in their
    // default state (renderable, and `.mask` either unset or the node's own
    // clip mask, untouched by us) — skip the loop entirely.
    if (host) {
      if (!hostsWithActiveMasking.has(host)) return;
      hostsWithActiveMasking.delete(host);
    }
    for (const id of orderedIds) {
      const container = getContainer(id);
      if (!container) continue;
      container.renderable = true;
      if (!container.mask) continue; // nothing to undo — cheap common case
      const ownClip = getOwnContainerMask(container);
      if (container.mask !== ownClip) container.mask = ownClip;
    }
    return;
  }

  if (host) hostsWithActiveMasking.add(host);

  const usedMaskerIds = new Set(maskerIdBySiblingId.values());

  for (const id of orderedIds) {
    const container = getContainer(id);
    if (!container) continue;

    const isInertMasker = maskerIds.has(id) && !usedMaskerIds.has(id);
    container.renderable = !isInertMasker;

    const maskerId = maskerIdBySiblingId.get(id);
    if (maskerId) {
      container.mask = resolveMaskTarget(maskerId, nodesById, getContainer);
    } else {
      // Restore a renderer-owned container mask, if it has one. A frame's
      // child-content clip is deliberately excluded by getOwnContainerMask.
      container.mask = getOwnContainerMask(container);
    }
  }
}
