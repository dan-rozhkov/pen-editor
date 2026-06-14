// Color, gradient and image-paint helpers shared by the node converters.

import type { GradientColorStop, GradientFill, ImageFill } from '@/types/scene'
import type { FigColor, FigMatrix, FigPaint } from '../figTypes'
import type { ConvertContext } from './types'

function channelToHex(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, '0')
}

export function colorToHex(color: FigColor): string {
  return `#${channelToHex(color.r)}${channelToHex(color.g)}${channelToHex(color.b)}`
}

export function colorToHex8(color: FigColor, extraOpacity = 1): string {
  return `${colorToHex(color)}${channelToHex(color.a * extraOpacity)}`
}

function paintIsVisible(paint: FigPaint): boolean {
  return paint.visible !== false && (paint.opacity ?? 1) > 0
}

/** Topmost visible paint of the given kinds (Figma paints are bottom-to-top). */
export function topPaint(paints: FigPaint[] | undefined, kinds: (paint: FigPaint) => boolean): FigPaint | null {
  if (!paints) return null
  for (let i = paints.length - 1; i >= 0; i--) {
    const paint = paints[i]
    if (paintIsVisible(paint) && kinds(paint)) return paint
  }
  return null
}

interface InvertedMatrix {
  apply: (x: number, y: number) => { x: number; y: number }
}

function invertMatrix(m: FigMatrix): InvertedMatrix | null {
  const det = m.m00 * m.m11 - m.m01 * m.m10
  if (!Number.isFinite(det) || Math.abs(det) < 1e-9) return null
  const i00 = m.m11 / det
  const i01 = -m.m01 / det
  const i10 = -m.m10 / det
  const i11 = m.m00 / det
  return {
    apply: (x: number, y: number) => {
      const dx = x - m.m02
      const dy = y - m.m12
      return { x: i00 * dx + i01 * dy, y: i10 * dx + i11 * dy }
    },
  }
}

function gradientStops(paint: FigPaint): GradientColorStop[] {
  const paintOpacity = paint.opacity ?? 1
  return (paint.stops ?? []).map((stop) => {
    const result: GradientColorStop = {
      color: colorToHex(stop.color),
      position: Math.max(0, Math.min(1, stop.position)),
    }
    const opacity = stop.color.a * paintOpacity
    if (opacity < 1) result.opacity = opacity
    return result
  })
}

/**
 * Figma gradient transforms map normalized object space into gradient space
 * (t = x' for linear). Inverting the matrix recovers the handle positions.
 */
export function convertGradient(paint: FigPaint): GradientFill | null {
  const stops = gradientStops(paint)
  if (stops.length === 0) return null
  const inverse = paint.transform ? invertMatrix(paint.transform) : null
  const isRadial = paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_DIAMOND'

  if (isRadial) {
    const center = inverse ? inverse.apply(0.5, 0.5) : { x: 0.5, y: 0.5 }
    const edge = inverse ? inverse.apply(1, 0.5) : { x: 1, y: 0.5 }
    const radius = Math.hypot(edge.x - center.x, edge.y - center.y) || 0.5
    return {
      type: 'radial',
      stops,
      startX: center.x,
      startY: center.y,
      endX: center.x,
      endY: center.y,
      endRadius: radius,
    }
  }

  // Linear (ANGULAR falls back to linear along the same axis)
  const start = inverse ? inverse.apply(0, 0.5) : { x: 0, y: 0.5 }
  const end = inverse ? inverse.apply(1, 0.5) : { x: 1, y: 0.5 }
  return {
    type: 'linear',
    stops,
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
  }
}

function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return 'image/png'
}

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `data:${sniffImageMime(bytes)};base64,${btoa(binary)}`
}

export function convertImagePaint(paint: FigPaint, ctx: ConvertContext): ImageFill | null {
  const blobIndex = paint.image?.dataBlob
  const blob = blobIndex != null ? ctx.blobs[blobIndex] : undefined
  if (!blob || blob.bytes.length === 0) {
    ctx.warnings.push(
      `Image "${paint.image?.name ?? 'unnamed'}" is not embedded in the clipboard payload`,
    )
    return null
  }
  const mode =
    paint.imageScaleMode === 'FIT' ? 'fit' : paint.imageScaleMode === 'STRETCH' ? 'stretch' : 'fill'
  return { url: bytesToDataUrl(blob.bytes), mode }
}
