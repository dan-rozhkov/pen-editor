import {
  generateId,
  type BlurEffect,
  type Effect,
  type FlatSceneNode,
  type GradientFill,
  type GradientPaint,
  type ImageFill,
  type ImagePaint,
  type Paint,
  type PatternFill,
  type PatternPaint,
  type SceneNode,
  type ShadowEffect,
  type SolidPaint,
} from '@/types/scene'
import { getDefaultShadow } from '@/utils/shadowUtils'

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

type EffectSource = Pick<SceneNode | FlatSceneNode, 'effect'> & { effects?: Effect[] }

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

/** Node updates that clear the legacy single-effect field. */
export function clearLegacyEffectProps(): Pick<FlatSceneNode, 'effect'> {
  return { effect: undefined }
}
