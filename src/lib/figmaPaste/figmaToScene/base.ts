// Shared node properties: position/size decomposition, fills, strokes,
// effects and corner radii applied to every converted node.

import { generateId, type PerCornerRadius } from '@/types/scene'
import type { FigNodeChange } from '../figTypes'
import { colorToHex, colorToHex8, convertGradient, convertImagePaint, topPaint } from './paints'
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
  const solid = topPaint(change.fillPaints, (p) => p.type === 'SOLID')
  if (solid?.color) {
    base.fill = colorToHex(solid.color)
    const opacity = solid.color.a * (solid.opacity ?? 1)
    if (opacity < 1) base.fillOpacity = opacity
  }
  const gradient = topPaint(change.fillPaints, (p) => p.type?.startsWith('GRADIENT_') === true)
  if (gradient) {
    const converted = convertGradient(gradient)
    if (converted) base.gradientFill = converted
  }
  const image = topPaint(change.fillPaints, (p) => p.type === 'IMAGE')
  if (image) {
    const converted = convertImagePaint(image, ctx)
    if (converted) {
      base.imageFill = converted
    } else if (!base.fill && !base.gradientFill) {
      base.fill = '#cccccc'
    }
  }
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

function applyEffects(base: MutableBase, change: FigNodeChange): void {
  const effects = change.effects ?? []
  const shadow =
    effects.find((e) => e.visible !== false && e.type === 'DROP_SHADOW') ??
    effects.find((e) => e.visible !== false && e.type === 'INNER_SHADOW')
  if (!shadow?.color) return
  base.effect = {
    type: 'shadow',
    shadowType: shadow.type === 'INNER_SHADOW' ? 'inner' : 'outer',
    color: colorToHex8(shadow.color),
    offset: { x: shadow.offset?.x ?? 0, y: shadow.offset?.y ?? 0 },
    blur: shadow.radius ?? 0,
    spread: shadow.spread ?? 0,
  }
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
