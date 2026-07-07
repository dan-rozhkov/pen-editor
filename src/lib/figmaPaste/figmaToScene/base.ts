// Shared node properties: position/size decomposition, fills, strokes,
// effects and corner radii applied to every converted node.

import { generateId, type Paint, type PerCornerRadius, type ShadowEffect } from '@/types/scene'
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

function applyStrokePaints(base: MutableBase, change: FigNodeChange, ctx: ConvertContext): void {
  const stroke = resolveStroke(change, ctx)
  if (!stroke) return
  base.stroke = stroke.color
  if (stroke.opacity != null) base.strokeOpacity = stroke.opacity
  base.strokeWidth = stroke.width
  if (change.strokeAlign) base.strokeAlign = stroke.align
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

function applyEffects(base: MutableBase, change: FigNodeChange): void {
  const shadows = (change.effects ?? [])
    .filter((e) => e.visible !== false && (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW'))
    .map(toShadowEffect)
    .filter((s): s is ShadowEffect => s !== null)
  if (shadows.length === 0) return
  if (shadows.length === 1) {
    // Single shadow keeps the legacy `effect` field (no id) for back-compat.
    base.effect = shadows[0]
    return
  }
  // Multiple shadows: the legacy single field can't represent the stack, so
  // `effects` becomes the source of truth. Ids back UI list keys/reordering.
  base.effects = shadows.map((shadow) => ({ ...shadow, id: generateId() }))
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
