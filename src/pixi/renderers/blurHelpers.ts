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
  if (radius != null) {
    const blur = new BlurFilter({ strength: radius / 2, quality: 3 }) as TaggedFilter;
    blur.__layerBlur = true;
    kept.push(blur);
  }
  container.filters = kept.length > 0 ? (kept as Filter[]) : [];
}
