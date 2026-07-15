// Shared node properties: position/size decomposition, fills, strokes,
// effects and corner radii applied to every converted node.

import { generateId, type Effect, type Paint, type PerCornerRadius, type ShadowEffect } from '@/types/scene'
import type { FigEffect, FigNodeChange } from '../figTypes'
import { colorToHex, colorToHex8, convertPaints, topPaint } from './paints'
import type { ConvertContext, MutableBase, StrokeStyle } from './types'

function decomposePosition(change: FigNodeChange): { x: number; y: number; rotation?: number } {
  const m = change.transform
  if (!m) return { x: 0, y: 0 }
  let rotationDeg = (Math.atan2(m.m10, m.m00) * 180) / Math.PI
  if (Math.abs(rotationDeg) < 0.01) rotationDeg = 0
  if (rotationDeg < 0) rotationDeg += 360
  return {
    x: m.m02,
    y: m.m12,
    ...(rotationDeg !== 0 ? { rotation: rotationDeg } : {}),
  }
}

export function buildBase(change: FigNodeChange, ctx: ConvertContext, withStroke = true): MutableBase {
  const { x, y, rotation } = decomposePosition(change)
  const base: MutableBase = {
    id: generateId(),
    x,
    y,
    width: change.size?.x ?? 0,
    height: change.size?.y ?? 0,
  }
  if (change.name) base.name = change.name
  if (rotation != null) base.rotation = rotation
  if (change.visible === false) base.visible = false
  if (change.opacity != null && change.opacity < 1) base.opacity = change.opacity

  applyFillPaints(base, change, ctx)
  // Path nodes render strokes through pathStroke — top-level stroke props
  // would double-draw there, so vector conversion opts out
  if (withStroke) applyStrokePaints(base, change, ctx)
  applyEffects(base, change)
  return base
}

// p1-21: fills/effects are always imported as inline values, never as a
// `styleId`/`effectStyleId` reference into `useStyleStore` — see the
// clipboard-format note at the top of `./paints.ts` for why shared Figma
// styles can't be recovered from the clipboard buffer.
function applyFillPaints(base: MutableBase, change: FigNodeChange, ctx: ConvertContext): void {
  const { paints, hadFailedImage } = convertPaints(change.fillPaints, ctx)
  if (paints.length >= 2) {
    // Multiple visible fills: the legacy single fields can't represent the
    // stack, so `fills` becomes the single source of truth.
    base.fills = paints
    return
  }
  if (paints.length === 1) {
    applyLegacyFill(base, paints[0])
    return
  }
  // No usable paint. Preserve the legacy gray fallback for a broken image fill.
  if (hadFailedImage) base.fill = '#cccccc'
}

/** Project a single paint onto the legacy single-fill fields. */
function applyLegacyFill(base: MutableBase, paint: Paint): void {
  if (paint.type === 'solid') {
    base.fill = paint.color
    if (paint.opacity != null && paint.opacity < 1) base.fillOpacity = paint.opacity
  } else if (paint.type === 'gradient') {
    base.gradientFill = paint.gradient
  } else if (paint.type === 'image') {
    base.imageFill = paint.image
  }
  // pattern paints have no legacy single-fill projection
}

/** Resolve the topmost stroke paint into a color/width/align triple. */
export function resolveStroke(change: FigNodeChange, ctx: ConvertContext): StrokeStyle | null {
  const paint = topPaint(change.strokePaints, (p) => p.type !== 'IMAGE')
  if (!paint) return null
  const style: StrokeStyle = {
    color: '',
    width: change.strokeWeight ?? 1,
    align:
      change.strokeAlign === 'INSIDE' ? 'inside' : change.strokeAlign === 'OUTSIDE' ? 'outside' : 'center',
  }
  if (paint.type === 'SOLID' && paint.color) {
    style.color = colorToHex(paint.color)
    const opacity = paint.color.a * (paint.opacity ?? 1)
    if (opacity < 1) style.opacity = opacity
  } else if (paint.stops && paint.stops.length > 0) {
    style.color = colorToHex(paint.stops[0].color)
    ctx.warnings.push(`Gradient stroke on "${change.name ?? 'node'}" approximated with a solid color`)
  } else {
    return null
  }
  return style
}

/**
 * Convert Figma's `strokePaints` into the editor's stroke stack (or, for the
 * single-solid-paint case, the legacy fields — mirrors `applyFillPaints`).
 * Previously this dropped every stroke but the topmost (`topPaint`) and
 * approximated a gradient stroke with its first stop's solid color (see
 * `resolveStroke`, still used for `path` nodes' `pathStroke` — which has no
 * gradient/multi-paint representation, an intentional scope limit, not this
 * bug). `convertPaints` already builds the full editor `Paint[]` for fills;
 * strokes reuse it verbatim, only excluding IMAGE paints (unsupported on a
 * stroke, matching the old `topPaint(..., p => p.type !== 'IMAGE')` filter).
 */
function applyStrokePaints(base: MutableBase, change: FigNodeChange, ctx: ConvertContext): void {
  const { paints } = convertPaints(change.strokePaints, ctx)
  const strokePaints = paints.filter((p) => p.type !== 'image')
  if (strokePaints.length === 0) return

  if (strokePaints.length >= 2 || strokePaints[0].type === 'gradient') {
    base.strokes = strokePaints
  } else {
    const solid = strokePaints[0]
    if (solid.type === 'solid') {
      base.stroke = solid.color
      if (solid.opacity != null) base.strokeOpacity = solid.opacity
    }
  }

  base.strokeWidth = change.strokeWeight ?? 1
  if (change.borderStrokeWeightsIndependent) {
    // Intentionally unconditional: `strokeWidthPerSide` is set purely from
    // Figma's own per-side-border flag, independent of what `base.strokes`
    // ended up as above — including a gradient-only stack, a combination the
    // editor's own UI (`StrokeSection`) otherwise blocks from being created
    // by hand. Not guarded here because it doesn't need to be: the renderer
    // (`applyStroke` in `pixi/renderers/fillStrokeHelpers.ts`) has an explicit
    // fallback for exactly this combination — a gradient-only stroke stack
    // with per-side widths renders as a uniform gradient stroke mapped to the
    // node's bbox (ignoring the per-side widths) rather than nothing, so
    // round-tripping this data stays renderable end-to-end.
    base.strokeWidthPerSide = {
      top: change.borderTopWeight ?? 0,
      right: change.borderRightWeight ?? 0,
      bottom: change.borderBottomWeight ?? 0,
      left: change.borderLeftWeight ?? 0,
    }
  }
  if (change.strokeAlign) {
    base.strokeAlign =
      change.strokeAlign === 'INSIDE' ? 'inside' : change.strokeAlign === 'OUTSIDE' ? 'outside' : 'center'
  }
}

/** Map a Figma shadow effect into the editor's shadow effect (null = unusable). */
function toShadowEffect(effect: FigEffect): ShadowEffect | null {
  if (!effect.color) return null
  return {
    type: 'shadow',
    shadowType: effect.type === 'INNER_SHADOW' ? 'inner' : 'outer',
    color: colorToHex8(effect.color),
    offset: { x: effect.offset?.x ?? 0, y: effect.offset?.y ?? 0 },
    blur: effect.radius ?? 0,
    spread: effect.spread ?? 0,
  }
}

/**
 * Map one Figma effect into the editor's effect (null = no equivalent).
 *
 * Figma's `EffectType` names layer blur FOREGROUND_BLUR, and carries leftover
 * `color`/`offset`/`spread` on blur effects, so the kind must be decided by
 * `type` alone. Effect kinds newer Figma versions added (REPEAT, GRAIN, NOISE,
 * GLASS, CUSTOM, …) have no editor equivalent and are skipped rather than
 * mis-imported. Progressive blur (`blurOpType: PROGRESSIVE`) degrades to a
 * uniform blur of the same radius — the editor has no gradient-blur ramp.
 */
function toEffect(effect: FigEffect): Effect | null {
  switch (effect.type) {
    case 'DROP_SHADOW':
    case 'INNER_SHADOW':
      return toShadowEffect(effect)
    case 'FOREGROUND_BLUR':
      return { type: 'blur', radius: effect.radius ?? 0 }
    case 'BACKGROUND_BLUR':
      return { type: 'background-blur', radius: effect.radius ?? 0 }
    default:
      return null
  }
}

function applyEffects(base: MutableBase, change: FigNodeChange): void {
  const effects = (change.effects ?? [])
    .filter((e) => e.visible !== false)
    .map(toEffect)
    .filter((e): e is Effect => e !== null)
  if (effects.length === 0) return
  if (effects.length === 1 && effects[0].type === 'shadow') {
    // A lone shadow keeps the legacy `effect` field (no id) for back-compat.
    // Blurs have no legacy field, so they always take the stack path below.
    base.effect = effects[0]
    return
  }
  // The legacy single field can't represent a stack (or a blur), so `effects`
  // becomes the source of truth. Ids back UI list keys/reordering.
  base.effects = effects.map((effect) => ({ ...effect, id: generateId() }))
}

export function perCornerRadius(change: FigNodeChange): PerCornerRadius | undefined {
  if (!change.rectangleCornerRadiiIndependent) return undefined
  const corners: PerCornerRadius = {}
  if (change.rectangleTopLeftCornerRadius) corners.topLeft = change.rectangleTopLeftCornerRadius
  if (change.rectangleTopRightCornerRadius) corners.topRight = change.rectangleTopRightCornerRadius
  if (change.rectangleBottomRightCornerRadius) corners.bottomRight = change.rectangleBottomRightCornerRadius
  if (change.rectangleBottomLeftCornerRadius) corners.bottomLeft = change.rectangleBottomLeftCornerRadius
  return Object.keys(corners).length > 0 ? corners : undefined
}
