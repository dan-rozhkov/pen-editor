import type { GlassEffect } from "@/types/scene";
import { createGlassEffect } from "@/utils/fillUtils";

/**
 * iOS `UIVisualEffectView` material presets — one-click starting points for
 * the Glass params in `EffectsSection`, tuned to read as genuinely distinct
 * thicknesses (Apple's Ultra Thin / Thin / Regular / Thick materials) rather
 * than small nudges of the same look. `Regular` is exactly
 * `createGlassEffect()`'s default tuple so picking it always matches "add
 * Glass" fresh. Kept in its own module (not `EffectsSection.tsx`) because
 * that file must only export the component for React Fast Refresh.
 */
type GlassPresetParams = Partial<Omit<GlassEffect, "type" | "id" | "visible">>;

/** Strip the identity fields (`type`/`id`) off a `GlassEffect`, leaving just the tunable params a preset applies. */
function toPresetParams(effect: GlassEffect): GlassPresetParams {
  const { type: _type, id: _id, ...params } = effect;
  return params;
}

export const GLASS_MATERIAL_PRESETS: {
  name: string;
  params: GlassPresetParams;
}[] = [
  {
    name: "Ultra Thin",
    params: {
      lightAngle: 135,
      lightIntensity: 0.35,
      refraction: 0.2,
      depth: 6,
      dispersion: 0.03,
      frost: 10,
      splay: 0.35,
      vibrancy: 0.35,
    },
  },
  {
    name: "Thin",
    params: {
      lightAngle: 135,
      lightIntensity: 0.45,
      refraction: 0.3,
      depth: 10,
      dispersion: 0.05,
      frost: 14,
      splay: 0.45,
      vibrancy: 0.45,
    },
  },
  {
    // Derived (not hand-typed) from `createGlassEffect()`'s own default
    // tuple, so retuning that factory can never silently break the
    // documented "Regular === add Glass fresh" invariant.
    name: "Regular",
    params: toPresetParams(createGlassEffect()),
  },
  {
    name: "Thick",
    params: {
      lightAngle: 135,
      lightIntensity: 0.7,
      refraction: 0.6,
      depth: 22,
      dispersion: 0.08,
      frost: 34,
      splay: 0.7,
      vibrancy: 0.6,
    },
  },
];

/** Apply a preset's params on top of an existing Glass effect, preserving its identity (`id`/`visible`/`type`). */
export function applyGlassPreset(
  effect: GlassEffect,
  preset: (typeof GLASS_MATERIAL_PRESETS)[number],
): GlassEffect {
  return { ...effect, ...preset.params };
}
