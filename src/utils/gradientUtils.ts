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

/**
 * Compute the angle (in degrees) of a linear gradient from its start/end points.
 * 0° = left→right, 90° = top→bottom, etc.
 */
export function getGradientAngle(gradient: GradientFill): number {
  const dx = gradient.endX - gradient.startX
  const dy = gradient.endY - gradient.startY
  const angle = Math.atan2(dy, dx) * (180 / Math.PI)
  // Normalize to 0-360
  return ((Math.round(angle) % 360) + 360) % 360
}

/**
 * Set start/end points of a linear gradient from an angle (degrees).
 * 0° = left→right, 90° = top→bottom, etc.
 */
export function setGradientAngle(gradient: GradientFill, angleDeg: number): GradientFill {
  const rad = angleDeg * (Math.PI / 180)
  return {
    ...gradient,
    startX: 0.5 - Math.cos(rad) * 0.5,
    startY: 0.5 - Math.sin(rad) * 0.5,
    endX: 0.5 + Math.cos(rad) * 0.5,
    endY: 0.5 + Math.sin(rad) * 0.5,
  }
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
