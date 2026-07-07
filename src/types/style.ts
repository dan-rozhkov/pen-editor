import type { Paint, Effect } from './scene'

/**
 * A named, reusable fill/color style (Figma-style "Color styles" /
 * "Paint styles"). Holds one full paint definition — solid, gradient, image,
 * or pattern — that a node's paint layer can reference by `styleId` instead
 * of carrying the value inline. A solid paint's `colorBinding` is honored
 * when the style itself is resolved, so a fill style can point at a
 * variable (style → variable → theme resolution chain).
 */
export interface FillStyle {
  id: string
  name: string
  paint: Paint
}

/**
 * A named, reusable effect style (Figma-style "Effect styles"): a full
 * shadow/blur stack a node's `effectStyleId` can reference instead of
 * carrying `effects` inline.
 */
export interface EffectStyle {
  id: string
  name: string
  effects: Effect[]
}

export function generateFillStyleId(): string {
  return 'fillstyle_' + Math.random().toString(36).substring(2, 9)
}

export function generateEffectStyleId(): string {
  return 'effectstyle_' + Math.random().toString(36).substring(2, 9)
}
