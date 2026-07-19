import type { Effect } from "@/types/scene";
import { getEffects, type EffectSource } from "@/utils/fillUtils";

/**
 * How far a node's own effects (shadows, layer blur) visually extend beyond
 * its geometric rect, in local (unrotated, unscaled) units.
 *
 * Used to expand culling/raster-cache bounds so a shadow/blur overhang isn't
 * treated as off-screen (bug-19 mechanism 3: culling rects are built from
 * node geometry only — grep confirms zero shadow/effect awareness in
 * `cullingIndex.ts` before this) just because the node's own rect is fully
 * off-screen or inside the raster-cache bake bounds.
 *
 * - Outer/drop shadow: `offset` translates the shadow shape, and `blur`
 *   (rendered as `BlurFilter({ strength: blur / 2 })`, see
 *   `renderers/shadowHelpers.ts`) bleeds `blur` px past that shape on every
 *   side (Pixi's own `BlurFilter.updatePadding` is `2 * strength`). `spread`
 *   grows the shape outward before that. Overhang beyond the node's own rect
 *   is therefore `|offset| + blur + spread`.
 * - Inner shadow: clipped to the node's own shape via a mask
 *   (`buildInnerShadowLayer`) — never overhangs, contributes 0.
 * - Layer blur (`type: "blur"`): blurs the node itself in place; same
 *   `strength = radius / 2` convention, so it bleeds `radius` px past the
 *   node's rect (`renderers/blurHelpers.ts`).
 * - Background blur (`type: "background-blur"`): baked to a sprite masked to
 *   the node's own shape (`renderers/backgroundBlurHelpers.ts`) — never
 *   overhangs, contributes 0.
 *
 * Deliberately reads only a node's own `effects`/`effect` fields (via
 * `getEffects`), not effect-style (`effectStyleId`) resolution — that needs
 * `styleStore`, which culling/raster-cache (pure, no-React-store modules)
 * don't have access to. A node using a shared effect style with an
 * overhanging shadow is a known, documented gap.
 */
export function effectMargin(effects: Effect[] | undefined): number {
  if (!effects || effects.length === 0) return 0;
  let margin = 0;
  for (const effect of effects) {
    if (effect.visible === false) continue;
    if (effect.type === "shadow") {
      if (effect.shadowType === "inner") continue;
      const overhang =
        Math.max(Math.abs(effect.offset.x), Math.abs(effect.offset.y), 0) +
        Math.max(0, effect.blur) +
        Math.max(0, effect.spread);
      if (overhang > margin) margin = overhang;
    } else if (effect.type === "blur") {
      if (effect.radius > margin) margin = effect.radius;
    }
    // background-blur: intentionally contributes 0 (see doc above).
  }
  return margin;
}

/** Convenience: effect margin computed directly from a node's own effect fields. */
export function nodeEffectMargin(node: EffectSource): number {
  return effectMargin(getEffects(node));
}

/**
 * Max effect margin over `rootId` and every descendant in its subtree.
 *
 * Used by `rasterCacheManager.ts` (bug-19 mechanism 2) to size a top-level
 * frame's `boundsArea` before baking it with `cacheAsTexture` — Pixi's own
 * bake-bounds computation (`getLocalBounds()`) does not account for filter
 * padding at all (see the doc on `buildShadowBlurFilter` in
 * `renderers/shadowHelpers.ts`), so a shadow/blur near a cached frame's edge
 * gets clipped at the baked texture's boundary unless the frame's own
 * `boundsArea` is explicitly widened to include the overhang.
 *
 * Deliberately a single scalar (not a per-descendant offset rect): applying
 * the max margin uniformly to the whole frame envelope is a conservative
 * over-approximation — any single descendant's overhang can't exceed its own
 * margin, and the frame's raw (unexpanded) bounds already include that
 * descendant's own geometry, so expanding the envelope by the subtree max on
 * every side is always at least as wide as the true (per-descendant,
 * per-direction) overhang.
 *
 * Not O(1) — walks the whole subtree — but this only runs once per bake
 * decision (raster-cache's ~600ms decision cadence, not a per-frame render
 * path), same cost class as the bake itself.
 */
export function subtreeEffectMargin(
  nodesById: Record<string, EffectSource>,
  childrenById: Record<string, string[] | undefined>,
  rootId: string,
): number {
  const node = nodesById[rootId];
  let margin = node ? nodeEffectMargin(node) : 0;
  for (const childId of childrenById[rootId] ?? []) {
    const childMargin = subtreeEffectMargin(nodesById, childrenById, childId);
    if (childMargin > margin) margin = childMargin;
  }
  return margin;
}
