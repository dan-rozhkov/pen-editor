import { UniformGroup } from "pixi.js";
import type { FlatSceneNode, GlassEffect, PerCornerRadius } from "@/types/scene";
import { hasPerCornerRadius } from "@/utils/renderUtils";

/**
 * Pure geometry/uniform-packing helpers for the live Glass/background-blur
 * backdrop material. Kept free of PixiJS filter/WebGL machinery so it's
 * fully unit-testable (`UniformGroup` itself does no GPU work at
 * construction time — see `node_modules/pixi.js/lib/rendering/renderers/
 * shared/shader/UniformGroup.mjs`). The render-time-only half (the
 * world-transform rows, which need the live `worldTransform` — see
 * `GlassBackdropFilter.writeLocalMatrix`) lives in
 * `filters/GlassBackdropFilter.ts` instead, and is e2e-only per this repo's
 * convention for anything needing a live WebGL context.
 */

type CornerNode = FlatSceneNode & {
  cornerRadius?: number;
  cornerRadiusPerCorner?: PerCornerRadius;
};

/**
 * Effective per-corner radius [TL, TR, BR, BL] in local px, mirroring
 * `drawRoundedShape`'s (`./fillStrokeHelpers`) resolution order: explicit
 * per-corner values win, then the unified `cornerRadius` (clamped to a
 * circle for a square node whose radius covers the whole shape), else 0.
 * Ellipses carry no meaningful corner radius — `shapeProfile` branches to
 * the ellipse SDF instead, so this returns all zeros for them.
 */
export function resolveCornerRadii(
  node: FlatSceneNode,
  width: number,
  height: number,
): [number, number, number, number] {
  if (node.type === "ellipse") return [0, 0, 0, 0];

  const cn = node as CornerNode;
  if (hasPerCornerRadius(cn.cornerRadiusPerCorner)) {
    const r = cn.cornerRadiusPerCorner!;
    return [r.topLeft ?? 0, r.topRight ?? 0, r.bottomRight ?? 0, r.bottomLeft ?? 0];
  }

  let radius = cn.cornerRadius ?? 0;
  if (radius > 0 && width === height && radius >= width / 2) radius = width / 2;
  return [radius, radius, radius, radius];
}

/** True when the node renders as an ellipse (`uIsEllipse` in the shader). */
export function isEllipseShape(node: FlatSceneNode): boolean {
  return node.type === "ellipse";
}

/**
 * Dispersion's widening factor on the base displacement magnitude — MUST
 * match the `DISPERSION_K` constant in `glassBackdrop.frag.ts`'s
 * `sampleDispersed` (the R/B channels sample at
 * `dispUv * (1 ± dispersion * DISPERSION_K)`). Duplicated rather than shared
 * because one lives in a GLSL string and the other in TS; keep them equal by
 * hand if either changes.
 */
const DISPERSION_K = 0.3;

/** Hard cap on `computeMaterialSurfacePadding`'s result, in px, so a pathological `depth`/`refraction` combination can't request an enormous filter texture. */
export const MAX_MATERIAL_PADDING = 200;

/**
 * How far (in px) the material surface's `Filter.padding` must extend past
 * the node's own rect so the shader has real backdrop pixels to sample,
 * instead of clamped copies of its own edge.
 *
 * `Filter.padding` defaults to 0, so with no padding the filter bounds — and
 * therefore the back texture `FilterSystem` crops for `activeBackTexture` —
 * are exactly the node's own rect (see `GlassBackdropFilter`'s doc comment
 * for the exact Pixi call chain). Every refracted/frosted sample that would
 * reach outside that rect gets clamped back to the edge instead, which is a
 * no-op exactly where refraction/frost read strongest — near the edge.
 *
 * Two independent reach terms, summed:
 *  - `refraction * depth` is the shader's maximum displacement magnitude
 *    (see `surfaceNormal`/`displacementLocalPx` in `glassBackdrop.frag.ts`:
 *    `h` maxes out at 1, so displacement maxes out at `refraction * depth`).
 *    Dispersion widens the R/B taps further by up to `DISPERSION_K`, folded
 *    in as `* (1 + dispersion * DISPERSION_K)`.
 *  - `frost` is the Gaussian blur reach. The frost `BlurFilter` runs INSIDE
 *    `GlassBackdropFilter.apply()` on the back texture (not as its own entry
 *    in the filter stack), so Pixi never contributes `BlurFilter`'s own
 *    padding for it — without adding it here, frost near an edge blurs
 *    against clamped edge pixels rather than real surroundings.
 *
 * Rounded up (`Filter.padding` participates in `_calculateFilterBounds` as
 * `bounds.pad((padding | 0) * paddingMultiplier)` — note the `| 0`, so a
 * fractional value would silently truncate) and capped at
 * `MAX_MATERIAL_PADDING`.
 */
export function computeMaterialSurfacePadding(effect: GlassEffect): number {
  const maxDisplacement = Math.max(0, effect.refraction) * Math.max(0, effect.depth) *
    (1 + Math.max(0, effect.dispersion) * DISPERSION_K);
  const reach = maxDisplacement + Math.max(0, effect.frost);
  return Math.min(MAX_MATERIAL_PADDING, Math.ceil(reach));
}

/**
 * Build a zeroed `glassUniforms` `UniformGroup` matching the shader's
 * declared fields (`glassBackdrop.frag.ts`). `uToLocalA`/`uToLocalB`/
 * `uWorldA`/`uWorldB` are left at zero here — they're only ever written by
 * `GlassBackdropFilter`'s render-time `writeLocalMatrix`, never by
 * `writeGlassEffectUniforms`/`writeGlassGeometryUniforms`.
 */
function glassUniformStructures() {
  return {
    uSize: { value: new Float32Array(2), type: "vec2<f32>" as const },
    uRadii: { value: new Float32Array(4), type: "vec4<f32>" as const },
    uParams: { value: new Float32Array(4), type: "vec4<f32>" as const },
    uLight: { value: new Float32Array(4), type: "vec4<f32>" as const },
    // Inverse-worldTransform rows: global(x,y,1) -> local px.
    uToLocalA: { value: new Float32Array(3), type: "vec3<f32>" as const },
    uToLocalB: { value: new Float32Array(3), type: "vec3<f32>" as const },
    // Forward worldTransform LINEAR part (no translation): local-px
    // displacement -> global-px displacement, for the exact per-axis
    // px->UV Jacobian computed in the fragment shader.
    uWorldA: { value: new Float32Array(2), type: "vec2<f32>" as const },
    uWorldB: { value: new Float32Array(2), type: "vec2<f32>" as const },
    uIsEllipse: { value: 0, type: "f32" as const },
  };
}

/** The `glassUniforms` `UniformGroup` type, with each field typed as its backing `Float32Array`. */
export type GlassUniformGroup = UniformGroup<ReturnType<typeof glassUniformStructures>>;

export function createGlassUniformGroup(): GlassUniformGroup {
  return new UniformGroup(glassUniformStructures());
}

/**
 * Write only the geometry-driven uniform fields (`uSize`, `uRadii`,
 * `uIsEllipse`) into `group` IN PLACE — no reallocation, so this is cheap
 * enough to call on every resize with no debounce (the whole point of a
 * live filter over the old bake-on-a-timer approach). Split out from
 * `writeGlassEffectUniforms` so a pure resize (`resizeMaterialSurface`) can
 * update size/shape without touching the effect params (`uParams`/`uLight`),
 * matching the split the spec draws between "effect changed" and
 * "size changed".
 *
 * There used to be a `uFlags.x` local-px->UV scale field derived from
 * `1 / width` here. It was wrong: it silently assumed the filter's input
 * texture bounds exactly equal the node's own unclipped global bounds,
 * which breaks the moment the node is partially off-screen (`Filter`'s
 * `clipToViewport` defaults to `true` — see `_calculateFilterBounds` in
 * `node_modules/pixi.js/lib/filters/FilterSystem.mjs`, `bounds.fitBounds(...)`
 * against the viewport) and is off by up to sqrt(2) for a rotated node
 * (axis-aligned bounds of a rotated box aren't `width * scale`). The
 * px->UV conversion is now done exactly, per-axis, in the fragment shader
 * from Pixi's own (post-clip, post-rounding) `uOutputFrame`/`uInputSize`
 * global uniforms plus the `uWorldA`/`uWorldB` forward-transform rows
 * `GlassBackdropFilter` writes — see `glassBackdrop.frag.ts`.
 */
export function writeGlassGeometryUniforms(
  group: GlassUniformGroup,
  node: FlatSceneNode,
  width: number,
  height: number,
): void {
  const u = group.uniforms;

  u.uSize[0] = width;
  u.uSize[1] = height;

  const [tl, tr, br, bl] = resolveCornerRadii(node, width, height);
  u.uRadii[0] = tl;
  u.uRadii[1] = tr;
  u.uRadii[2] = br;
  u.uRadii[3] = bl;

  u.uIsEllipse = isEllipseShape(node) ? 1 : 0;
}

/**
 * Write a (already-normalized) `GlassEffect`'s params plus this node's
 * geometry into `group` IN PLACE. `uToLocalA`/`uToLocalB` are left
 * untouched here — they're only ever written by `GlassBackdropFilter`'s
 * render-time `_writeLocalMatrix` (they need the live `worldTransform`,
 * which isn't known until render).
 */
export function writeGlassEffectUniforms(
  group: GlassUniformGroup,
  effect: GlassEffect,
  node: FlatSceneNode,
  width: number,
  height: number,
): void {
  writeGlassGeometryUniforms(group, node, width, height);

  const u = group.uniforms;
  u.uParams[0] = effect.refraction;
  u.uParams[1] = Math.max(1, effect.depth);
  u.uParams[2] = effect.dispersion;
  u.uParams[3] = effect.splay;

  const radians = (effect.lightAngle * Math.PI) / 180;
  u.uLight[0] = Math.cos(radians);
  u.uLight[1] = Math.sin(radians);
  u.uLight[2] = effect.lightIntensity;
  u.uLight[3] = 0;
}
