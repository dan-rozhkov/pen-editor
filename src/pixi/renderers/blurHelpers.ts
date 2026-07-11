import { BlurFilter, type Container, type Filter } from "pixi.js";
import type { Effect } from "@/types/scene";

/**
 * Effective layer-blur radius from a renderable (already visibility-filtered)
 * effect stack. Only ONE layer blur applies per node: the first visible blur
 * with radius > 0 wins (matches the CSS export in designToHtml).
 */
export function pickLayerBlurRadius(effects: Effect[]): number | null {
  for (const effect of effects) {
    if (effect.type === "blur" && effect.radius > 0) return effect.radius;
  }
  return null;
}

/**
 * Effective background-blur radius from a renderable effect stack. Only ONE
 * background blur applies per node: the first visible one with radius > 0
 * wins (same convention as layer blur / the CSS export in designToHtml).
 */
export function pickBackgroundBlurRadius(effects: Effect[]): number | null {
  for (const effect of effects) {
    if (effect.type === "background-blur" && effect.radius > 0) return effect.radius;
  }
  return null;
}

type TaggedFilter = Filter & { __layerBlur?: true };

/** Containers that already have the layer-blur destroy-teardown hook registered (avoid double-attaching). */
const destroyHooked = new WeakSet<Container>();

/**
 * The layer-blur filter currently owned by each container, tracked
 * independently of `container.filters` so the destroy hook can still find
 * (and free) it even if something else has since cleared/replaced
 * `container.filters` out from under us.
 */
const layerBlurFilterByContainer = new WeakMap<Container, TaggedFilter>();

/**
 * Register a one-time teardown that destroys `container`'s layer-blur
 * BlurFilter when the container itself is destroyed. `syncNodeTree`'s
 * node-deletion path calls `container.destroy({ children: true })`, which
 * does NOT destroy `container.filters` (Pixi 8 leaves them alive — see the
 * matching comment in `backgroundBlurHelpers.ts`), so without this hook every
 * deleted node that had a layer blur permanently leaks a BlurFilter (bug-08).
 * Guarded by a WeakSet so it's only attached once per container, mirroring
 * `ensureBackgroundBlurDestroyHook`.
 */
function ensureLayerBlurDestroyHook(container: Container): void {
  if (destroyHooked.has(container)) return;
  destroyHooked.add(container);
  container.once("destroyed", () => {
    const filter = layerBlurFilterByContainer.get(container);
    layerBlurFilterByContainer.delete(container);
    // Filter.destroy() is idempotent (no public `destroyed` flag to guard on,
    // unlike Texture/Container), so it's safe to call unconditionally here.
    filter?.destroy();
  });
}

/**
 * Apply (or clear) the node's layer blur as a container-level BlurFilter.
 * Only filters tagged as layer blur are touched, so any other filters a
 * future feature puts on the container survive. Same strength convention as
 * shadow blur in shadowHelpers.ts (strength = radius / 2).
 */
export function applyLayerBlur(container: Container, effects: Effect[]): void {
  const radius = pickLayerBlurRadius(effects);
  const existing = ((container.filters as Filter[] | null) ?? []) as TaggedFilter[];
  const kept = existing.filter((f) => !f.__layerBlur);
  for (const f of existing) {
    if (f.__layerBlur) f.destroy();
  }
  layerBlurFilterByContainer.delete(container);
  if (radius != null) {
    const blur = new BlurFilter({ strength: radius / 2, quality: 3 }) as TaggedFilter;
    blur.__layerBlur = true;
    kept.push(blur);
    layerBlurFilterByContainer.set(container, blur);
    ensureLayerBlurDestroyHook(container);
  }
  container.filters = kept.length > 0 ? (kept as Filter[]) : [];
}
