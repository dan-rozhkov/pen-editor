import type { Container, Filter } from "pixi.js";

const OVERVIEW_SCALE = 0.2;
const EFFECT_LABELS = new Set([
  "shadow-layer",
  "inner-shadow-layer",
  "background-blur-fill",
]);
const previousEffectRenderability = new WeakMap<Container, boolean>();
const previousFilterEnabled = new WeakMap<Filter, boolean>();

type LayerBlurFilter = Filter & { __layerBlur?: true };

export const isOverviewScale = (scale: number): boolean => scale <= OVERVIEW_SCALE;

/** Toggle only renderer-owned effect objects, retaining their previous state. */
export function applyOverviewEffectVisibility(
  container: Container,
  overview: boolean,
): void {
  for (const child of container.children) {
    if (!EFFECT_LABELS.has(child.label)) continue;
    if (overview) {
      if (!previousEffectRenderability.has(child)) {
        previousEffectRenderability.set(child, child.renderable);
      }
      child.renderable = false;
    } else {
      const previous = previousEffectRenderability.get(child);
      if (previous !== undefined) child.renderable = previous;
      previousEffectRenderability.delete(child);
    }
  }

  for (const filter of (container.filters ?? []) as Filter[]) {
    const layerBlur = filter as LayerBlurFilter;
    if (!layerBlur.__layerBlur) continue;
    if (overview) {
      if (!previousFilterEnabled.has(filter)) {
        previousFilterEnabled.set(filter, filter.enabled);
      }
      filter.enabled = false;
    } else {
      const previous = previousFilterEnabled.get(filter);
      if (previous !== undefined) filter.enabled = previous;
      previousFilterEnabled.delete(filter);
    }
  }
}

