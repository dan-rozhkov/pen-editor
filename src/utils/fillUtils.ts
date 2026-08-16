import {
  generateId,
  type BackgroundBlurEffect,
  type BaseNode,
  type BlurEffect,
  type Effect,
  type FlatSceneNode,
  type GlassEffect,
  type GradientFill,
  type GradientPaint,
  type ImageFill,
  type ImagePaint,
  type NoiseEffect,
  type Paint,
  type PathStroke,
  type PatternFill,
  type PatternPaint,
  type SceneNode,
  type ShadowEffect,
  type SolidPaint,
  type VideoFill,
  type VideoPaint,
  type VideoPlayback,
} from '@/types/scene'
import { getDefaultShadow, parseHexAlpha } from '@/utils/shadowUtils'
import type { EffectStyle, FillStyle } from '@/types/style'

/**
 * Fill/effect stack helpers.
 *
 * Contract: when `node.fills` is defined it is the single source of truth and
 * the legacy `fill`/`gradientFill`/`imageFill`/`fillOpacity`/`fillBinding`
 * fields are ignored. Old documents that only carry the legacy fields are
 * normalized lazily via `getFills()` — no .pen migration is required.
 * Writers that set `fills` should clear the legacy fields (see
 * `clearLegacyFillProps`) so the two representations never diverge.
 */

type FillSource = Pick<
  SceneNode | FlatSceneNode,
  'fill' | 'fillOpacity' | 'fillBinding' | 'gradientFill' | 'imageFill'
> & { fills?: Paint[] }

export type EffectSource = Pick<SceneNode | FlatSceneNode, 'effect'> & { effects?: Effect[] }

export function createSolidPaint(color: string, init?: Partial<Omit<SolidPaint, 'type' | 'color'>>): SolidPaint {
  return { id: generateId(), type: 'solid', color, ...init }
}

export function createGradientPaint(gradient: GradientFill, init?: Partial<Omit<GradientPaint, 'type' | 'gradient'>>): GradientPaint {
  return { id: generateId(), type: 'gradient', gradient, ...init }
}

export function createImagePaint(image: ImageFill, init?: Partial<Omit<ImagePaint, 'type' | 'image'>>): ImagePaint {
  return { id: generateId(), type: 'image', image, ...init }
}

export function createPatternPaint(pattern: PatternFill, init?: Partial<Omit<PatternPaint, 'type' | 'pattern'>>): PatternPaint {
  return { id: generateId(), type: 'pattern', pattern, ...init }
}

/**
 * Default video playback config. Muted is `true` so an autoplaying preview is
 * allowed by browser autoplay policy (unmuted autoplay is blocked) — see
 * `VideoPlayback`. Autoplay + loop on by default so a dropped/placed video
 * behaves like a live background out of the box.
 */
export function createDefaultVideoPlayback(): VideoPlayback {
  return { autoplay: true, loop: true, muted: true }
}

export function createVideoPaint(video: VideoFill, init?: Partial<Omit<VideoPaint, 'type' | 'video'>>): VideoPaint {
  return { id: generateId(), type: 'video', video, ...init }
}

// Deterministic ids for paints derived from legacy fields. Stable across
// calls/renders (stable React keys, no churn); unique within a single node's
// stack, which is the only scope paint ids are used in.
export const LEGACY_BASE_PAINT_ID = 'legacy-fill'
export const LEGACY_IMAGE_PAINT_ID = 'legacy-image'

/**
 * Derive the paint stack from the legacy single-fill fields. Mirrors the
 * legacy rendering exactly: a solid OR gradient base layer (gradient wins),
 * with an image sprite layered on top when `imageFill` is set.
 */
export function legacyFillsToPaints(node: FillSource): Paint[] {
  const paints: Paint[] = []
  if (node.gradientFill) {
    paints.push({ id: LEGACY_BASE_PAINT_ID, type: 'gradient', gradient: node.gradientFill })
  } else if (node.fill !== undefined) {
    const solid: SolidPaint = { id: LEGACY_BASE_PAINT_ID, type: 'solid', color: node.fill }
    if (node.fillOpacity !== undefined) solid.opacity = node.fillOpacity
    if (node.fillBinding !== undefined) solid.colorBinding = node.fillBinding
    paints.push(solid)
  }
  if (node.imageFill) {
    paints.push({ id: LEGACY_IMAGE_PAINT_ID, type: 'image', image: node.imageFill })
  }
  return paints
}

// getFills is on the Pixi hot path (every redraw of every node, every frame
// during drag/resize). Cache the derived legacy stack per node object — flat
// nodes are replaced immutably on change, so the cache never goes stale.
const legacyFillsCache = new WeakMap<object, Paint[]>()

/**
 * Read a node's paint stack (bottom-to-top). Falls back to the legacy
 * single-fill fields when `fills` is not set. The returned array must be
 * treated as immutable (it may be the node's own `fills` or a cached
 * derivation).
 */
export function getFills(node: FillSource): Paint[] {
  if (node.fills) return node.fills
  let cached = legacyFillsCache.get(node)
  if (!cached) {
    cached = legacyFillsToPaints(node)
    legacyFillsCache.set(node, cached)
  }
  return cached
}

/** Paints that should actually render (visible, non-zero opacity). */
export function getRenderableFills(node: FillSource): Paint[] {
  return getFills(node).filter((p) => p.visible !== false && (p.opacity ?? 1) > 0)
}

/**
 * The topmost visible solid paint, if any. The single place that encodes the
 * "which paint is *the* color of this node" rule (e.g. property search, text
 * color).
 */
export function getPrimarySolidPaint(node: FillSource): SolidPaint | undefined {
  const fills = getFills(node)
  for (let i = fills.length - 1; i >= 0; i--) {
    const paint = fills[i]
    if (paint.type === 'solid' && paint.visible !== false) return paint
  }
  return undefined
}

/** The topmost visible solid paint's color, if any. */
export function getPrimarySolidColor(node: FillSource): string | undefined {
  return getPrimarySolidPaint(node)?.color
}

/**
 * Node updates that clear the legacy single-fill fields. Spread into the same
 * update that sets `fills` so the legacy representation never diverges:
 * `updateNode(id, { fills, ...clearLegacyFillProps() })`
 */
export function clearLegacyFillProps(): Pick<
  FlatSceneNode,
  'fill' | 'fillOpacity' | 'fillBinding' | 'gradientFill' | 'imageFill'
> {
  return {
    fill: undefined,
    fillOpacity: undefined,
    fillBinding: undefined,
    gradientFill: undefined,
    imageFill: undefined,
  }
}

/**
 * Read a node's effect stack (bottom-to-top). Falls back to the legacy
 * single `effect` field when `effects` is not set.
 */
export function getEffects(node: EffectSource): Effect[] {
  if (node.effects) return node.effects
  return node.effect ? [node.effect] : []
}

/** Effects that should actually render (visible). */
export function getRenderableEffects(node: EffectSource): Effect[] {
  return getEffects(node).filter((e) => e.visible !== false)
}

export function createShadowEffect(init?: Partial<Omit<ShadowEffect, 'type'>>): ShadowEffect {
  return {
    ...getDefaultShadow(),
    id: generateId(),
    ...init,
  }
}

export function createBlurEffect(init?: Partial<Omit<BlurEffect, 'type'>>): BlurEffect {
  return {
    type: 'blur',
    radius: 4,
    id: generateId(),
    ...init,
  }
}

export function createBackgroundBlurEffect(
  init?: Partial<Omit<BackgroundBlurEffect, 'type'>>,
): BackgroundBlurEffect {
  return {
    type: 'background-blur',
    radius: 4,
    id: generateId(),
    ...init,
  }
}

/**
 * Default Glass: tuned to read as Apple's iOS "Liquid Glass" *regular*
 * material (UIVisualEffectView-style) rather than a decorative refraction
 * effect — strong frost, moderate refraction/depth, low dispersion (real
 * glass barely fringes), and `vibrancy` at its midpoint so the backdrop
 * reads saturated/lifted without blowing out.
 */
export function createGlassEffect(init?: Partial<Omit<GlassEffect, 'type'>>): GlassEffect {
  return {
    type: 'glass',
    lightAngle: 135,
    lightIntensity: 0.55,
    refraction: 0.45,
    depth: 14,
    dispersion: 0.06,
    frost: 18,
    splay: 0.55,
    vibrancy: 0.5,
    id: generateId(),
    ...init,
  }
}

/** Clamp `value` into [min, max], substituting `fallback` for NaN/non-finite input. */
function clampFinite(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/**
 * Coerce a `GlassEffect` from an imported/AI-authored document into the
 * documented ranges (see `GlassEffect` in `@/types/scene`). Never rejects:
 * NaN/missing/out-of-range values fall back to the defaults rather than
 * disabling the effect, so a malformed document still renders something
 * sensible. `lightAngle` wraps rather than clamps (an angle is cyclic).
 */
export function normalizeGlassEffect(effect: GlassEffect): GlassEffect {
  const defaults = createGlassEffect()
  const rawAngle = effect.lightAngle
  const lightAngle =
    typeof rawAngle === 'number' && Number.isFinite(rawAngle)
      ? ((rawAngle % 360) + 360) % 360
      : defaults.lightAngle
  return {
    ...effect,
    lightAngle,
    lightIntensity: clampFinite(effect.lightIntensity, 0, 1, defaults.lightIntensity),
    refraction: clampFinite(effect.refraction, 0, 1, defaults.refraction),
    depth: clampFinite(effect.depth, 1, 1000, defaults.depth),
    dispersion: clampFinite(effect.dispersion, 0, 1, defaults.dispersion),
    frost: clampFinite(effect.frost, 0, 100, defaults.frost),
    splay: clampFinite(effect.splay, 0, 1, defaults.splay),
    // `vibrancy` is optional on the type (back-compat: documents saved
    // before this field existed have none). `clampFinite`'s NaN branch
    // covers `undefined` too (`typeof undefined !== 'number'`), so a
    // missing field falls back to the DEFAULT (0.5), not to 0 — an old
    // document should read as the current default look, not as "no
    // vibrancy".
    vibrancy: clampFinite(effect.vibrancy as number, 0, 1, defaults.vibrancy!),
  }
}

/**
 * The one effect that owns a node's "material" slot, or `undefined`.
 *
 * Glass and background blur are mutually exclusive — Figma documents that a
 * layer renders whichever of the two comes first in the stack and ignores the
 * other. `effects` is bottom-to-top, so "first" means the lowest visible one.
 * A second Glass (or a background blur under a Glass) is inert, which is why
 * the renderer picks through here rather than `.find(e => e.type === 'glass')`
 * — an imported document may legitimately carry several.
 *
 * Pass an already-renderable stack (`getRenderableEffects` /
 * `getResolvedRenderableEffects`); this only re-checks `visible` defensively.
 */
export function pickMaterialEffect(
  effects: Effect[],
): GlassEffect | BackgroundBlurEffect | undefined {
  for (const effect of effects) {
    if (effect.visible === false) continue
    if (effect.type === 'glass') return normalizeGlassEffect(effect)
    if (effect.type === 'background-blur') return effect
  }
  return undefined
}

/**
 * True when the node's paint stack certainly hides anything painted behind it,
 * making a material (Glass/background blur) pass invisible and therefore
 * skippable.
 *
 * SCOPE: "the fill covers the node's box" is only true for box-filling node
 * types — `rect`, `ellipse`, `frame`. On a `text` node the fill is the GLYPH
 * colour, and on `path`/`polygon`/`line` it fills a shape that is mostly not
 * the bounding box; an opaque fill there hides almost none of the backdrop.
 * Callers using this to skip a backdrop-dependent pass must gate on node type
 * first (see `pixi/renderers/liveBackdropHelpers.ts`) — otherwise ordinary
 * black text silently loses its material effect.
 *
 * Deliberately CONSERVATIVE: it returns true only for a stack whose opacity it
 * can prove — a top solid/gradient-free paint at full alpha, full paint
 * opacity, full node opacity, no blend mode and no variable binding. Anything
 * it cannot read (a colour behind a `colorBinding`, an image/video/pattern
 * paint, a non-normal blend mode) returns false, so the effect still renders.
 * A wrong `true` would silently drop pixels the user asked for; a wrong
 * `false` only costs a filter pass.
 */
export function hasOpaqueEffectiveFill(
  node: FillSource & { opacity?: number },
): boolean {
  if ((node.opacity ?? 1) < 1) return false
  const fills = getRenderableFills(node)
  for (let i = fills.length - 1; i >= 0; i--) {
    const paint = fills[i]
    if ((paint.opacity ?? 1) < 1) continue
    if (paint.blendMode && paint.blendMode !== 'normal') continue
    if (paint.type !== 'solid') continue
    // A bound colour resolves through the variable/theme chain at render time
    // and may well be translucent — unreadable here, so never treated as opaque.
    if (paint.colorBinding) continue
    if (parseHexAlpha(paint.color).opacity >= 1) return true
  }
  return false
}

export function createNoiseEffect(init?: Partial<Omit<NoiseEffect, 'type'>>): NoiseEffect {
  return {
    type: 'noise',
    noiseType: 'mono',
    color: '#00000080',
    noiseSize: 1,
    density: 0.5,
    id: generateId(),
    ...init,
  }
}

/** Node updates that clear the legacy single-effect field. */
export function clearLegacyEffectProps(): Pick<FlatSceneNode, 'effect'> {
  return { effect: undefined }
}

// --- Shared styles (fillStyles/effectStyles) resolution ---
//
// Pure, store-free resolution: given the document's style collections,
// substitute a `styleId` reference for the value it points at. Live theme/
// variable resolution of any `colorBinding` embedded in the resolved value
// happens one layer up, in the Pixi-facing wrapper
// (`pixi/renderers/colorHelpers.ts#getResolvedRenderableFills`/
// `getResolvedRenderableEffects`) which has access to the variable store —
// this file stays store-free and unit-testable in isolation.

/**
 * Resolve a single paint layer: if it references a fill style (`styleId`),
 * substitute the style's paint definition (color/gradient/image/pattern),
 * keeping this layer's own id/visible/opacity/blendMode. Falls back to the
 * layer's own inline fields when the style is missing (dangling reference,
 * e.g. the style was deleted).
 */
export function resolveFillStylePaint(paint: Paint, fillStyles: FillStyle[]): Paint {
  if (!paint.styleId) return paint
  const style = fillStyles.find((s) => s.id === paint.styleId)
  if (!style) return paint
  return {
    ...style.paint,
    id: paint.id,
    visible: paint.visible,
    opacity: paint.opacity,
    blendMode: paint.blendMode,
    styleId: paint.styleId,
  }
}

/** Node's renderable fill stack with any fill-style references substituted in. */
export function getResolvedRenderableFills(node: FillSource, fillStyles: FillStyle[]): Paint[] {
  return getRenderableFills(node).map((p) => resolveFillStylePaint(p, fillStyles))
}

// --- Stroke paint stack ---
//
// Mirrors the fill stack above, but geometry (strokeWidth/strokeAlign/
// strokeWidthPerSide) stays on the node — see `BaseNode.strokes` doc comment.
// Also folds in `PathStroke` (path-node-only legacy stroke model) as a
// second, lower-priority fallback beneath `stroke`/`strokeOpacity`/
// `strokeBinding`, completing the migration flagged in the task spec
// (previously only done ad hoc in `StrokeSection.tsx`'s edit path).

type StrokeSource = Pick<BaseNode, 'stroke' | 'strokeOpacity' | 'strokeBinding'> & {
  strokes?: Paint[]
  pathStroke?: PathStroke
}

export const LEGACY_STROKE_PAINT_ID = 'legacy-stroke'

/**
 * Derive the stroke paint stack from the legacy single-stroke fields (and,
 * for path nodes without those, `PathStroke.fill`). A single solid layer —
 * gradients never had a legacy stroke representation.
 */
export function legacyStrokesToPaints(node: StrokeSource): Paint[] {
  const color = node.stroke ?? node.pathStroke?.fill
  if (color === undefined) return []
  const solid: SolidPaint = { id: LEGACY_STROKE_PAINT_ID, type: 'solid', color }
  if (node.strokeOpacity !== undefined) solid.opacity = node.strokeOpacity
  if (node.strokeBinding !== undefined) solid.colorBinding = node.strokeBinding
  return [solid]
}

const legacyStrokesCache = new WeakMap<object, Paint[]>()

/**
 * Read a node's stroke paint stack (bottom-to-top). Falls back to the legacy
 * single-stroke fields (and `PathStroke.fill`) when `strokes` is not set.
 */
export function getStrokes(node: StrokeSource): Paint[] {
  if (node.strokes) return node.strokes
  let cached = legacyStrokesCache.get(node)
  if (!cached) {
    cached = legacyStrokesToPaints(node)
    legacyStrokesCache.set(node, cached)
  }
  return cached
}

/** Stroke paints that should actually render (visible, non-zero opacity). */
export function getRenderableStrokes(node: StrokeSource): Paint[] {
  return getStrokes(node).filter((p) => p.visible !== false && (p.opacity ?? 1) > 0)
}

/**
 * Node updates that clear the legacy single-stroke fields (color only —
 * geometry fields `strokeWidth`/`strokeAlign`/`strokeWidthPerSide` are never
 * cleared here, they remain node-level regardless of paint model). Spread
 * into the same update that sets `strokes`:
 * `updateNode(id, { strokes, ...clearLegacyStrokeProps() })`
 */
export function clearLegacyStrokeProps(): Pick<FlatSceneNode, 'stroke' | 'strokeOpacity' | 'strokeBinding'> {
  return { stroke: undefined, strokeOpacity: undefined, strokeBinding: undefined }
}

/** Node's renderable stroke stack with any fill-style references substituted in. */
export function getResolvedRenderableStrokes(node: StrokeSource, fillStyles: FillStyle[]): Paint[] {
  return getRenderableStrokes(node).map((p) => resolveFillStylePaint(p, fillStyles))
}

/**
 * Resolve a node's effective effect stack: when `effectStyleId` is set, the
 * whole stack is sourced from the referenced effect style (falling back to
 * the node's own `effects`/`effect` when the style is missing). Effect
 * styles apply to the full stack at once (Figma parity), unlike fill styles
 * which are per-layer.
 */
export function resolveEffectStack(
  node: EffectSource & { effectStyleId?: string },
  effectStyles: EffectStyle[],
): Effect[] {
  if (node.effectStyleId) {
    const style = effectStyles.find((s) => s.id === node.effectStyleId)
    if (style) return style.effects.filter((e) => e.visible !== false)
  }
  return getRenderableEffects(node)
}
