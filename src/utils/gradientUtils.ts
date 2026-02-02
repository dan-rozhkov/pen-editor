import type { GradientFill, GradientColorStop, GradientType } from '@/types/scene'

/**
 * Create a default gradient with 2 stops.
 */
export function getDefaultGradient(type: GradientType): GradientFill {
  if (type === 'radial') {
    return {
      type: 'radial',
      stops: [
        { color: '#ffffff', position: 0 },
        { color: '#000000', position: 1 },
      ],
      startX: 0.5,
      startY: 0.5,
      endX: 0.5,
      endY: 0.5,
      startRadius: 0,
      endRadius: 0.5,
    }
  }
  return {
    type: 'linear',
    stops: [
      { color: '#ffffff', position: 0 },
      { color: '#000000', position: 1 },
    ],
    startX: 0,
    startY: 0.5,
    endX: 1,
    endY: 0.5,
  }
}

/**
 * Build Konva gradient props from a GradientFill.
 * Returns an object to spread onto a Konva shape.
 *
 * For Ellipse nodes, pass isEllipse=true — Konva Ellipse uses center-based
 * coordinates so gradient points need to be offset by -width/2, -height/2.
 */
export function buildKonvaGradientProps(
  gradient: GradientFill,
  width: number,
  height: number,
  isEllipse = false,
): Record<string, unknown> {
  const offsetX = isEllipse ? -width / 2 : 0
  const offsetY = isEllipse ? -height / 2 : 0

  // Build color stops array: [position, color, position, color, ...]
  const sorted = [...gradient.stops].sort((a, b) => a.position - b.position)
  const colorStops: (string | number)[] = []
  for (const stop of sorted) {
    colorStops.push(stop.position)
    if (stop.opacity !== undefined && stop.opacity < 1) {
      colorStops.push(applyStopOpacity(stop.color, stop.opacity))
    } else {
      colorStops.push(stop.color)
    }
  }

  if (gradient.type === 'linear') {
    return {
      fillLinearGradientStartPoint: {
        x: gradient.startX * width + offsetX,
        y: gradient.startY * height + offsetY,
      },
      fillLinearGradientEndPoint: {
        x: gradient.endX * width + offsetX,
        y: gradient.endY * height + offsetY,
      },
      fillLinearGradientColorStops: colorStops,
    }
  }

  // Radial
  const maxDim = Math.max(width, height)
  return {
    fillRadialGradientStartPoint: {
      x: gradient.startX * width + offsetX,
      y: gradient.startY * height + offsetY,
    },
    fillRadialGradientEndPoint: {
      x: gradient.endX * width + offsetX,
      y: gradient.endY * height + offsetY,
    },
    fillRadialGradientStartRadius: (gradient.startRadius ?? 0) * maxDim,
    fillRadialGradientEndRadius: (gradient.endRadius ?? 0.5) * maxDim,
    fillRadialGradientColorStops: colorStops,
  }
}

/**
 * Interpolate color at a given position between sorted stops.
 */
export function interpolateColorAtPosition(
  stops: GradientColorStop[],
  position: number,
): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position)
  if (sorted.length === 0) return '#888888'
  if (position <= sorted[0].position) return sorted[0].color
  if (position >= sorted[sorted.length - 1].position) return sorted[sorted.length - 1].color

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (position >= a.position && position <= b.position) {
      const t = (position - a.position) / (b.position - a.position)
      return lerpColor(a.color, b.color, t)
    }
  }
  return sorted[sorted.length - 1].color
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ]
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

function lerpColor(c1: string, c2: string, t: number): string {
  const [r1, g1, b1] = parseHex(c1)
  const [r2, g2, b2] = parseHex(c2)
  const r = Math.round(r1 + (r2 - r1) * t)
  const g = Math.round(g1 + (g2 - g1) * t)
  const b = Math.round(b1 + (b2 - b1) * t)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function applyStopOpacity(color: string, opacity: number): string {
  const [r, g, b] = parseHex(color)
  return `rgba(${r},${g},${b},${opacity})`
}

/**
 * Build a CSS linear-gradient string for preview purposes.
 */
export function buildCSSGradient(stops: GradientColorStop[]): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position)
  const parts = sorted.map(
    (s) => `${s.color} ${Math.round(s.position * 100)}%`,
  )
  return `linear-gradient(to right, ${parts.join(', ')})`
}
