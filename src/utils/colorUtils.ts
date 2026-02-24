import type { Variable, ThemeName } from '../types/variable'
import { getVariableValue } from '../types/variable'

function normalizeVariableRefName(name: string): string {
  return name.trim().replace(/^\$/, '')
}

function canonicalizeVariableToken(name: string): string {
  return name
    .trim()
    .replace(/^\$/, '')
    .replace(/^--/, '')
    .replace(/_/g, '-')
    .toLowerCase()
}

/**
 * Resolve a generic variable value (string) from binding or use direct value
 */
export function resolveVariableValue(
  directValue: string | undefined,
  binding: { variableId: string } | undefined,
  variables: Variable[],
  currentTheme: ThemeName
): string | undefined {
  if (binding) {
    const variable = variables.find((v) => v.id === binding.variableId)
    if (variable) {
      return getVariableValue(variable, currentTheme)
    }
  }

  // Fallback: support direct "$varName" references even without explicit bindings.
  if (typeof directValue === 'string' && directValue.trim().startsWith('$')) {
    const refName = normalizeVariableRefName(directValue)
    const refCanonical = canonicalizeVariableToken(directValue)
    const variable = variables.find((v) => {
      const normalizedVarName = normalizeVariableRefName(v.name)
      const varIdCanonical = canonicalizeVariableToken(v.id)
      const varNameCanonical = canonicalizeVariableToken(v.name)
      const normalizedNameCanonical = canonicalizeVariableToken(normalizedVarName)
      return (
        v.id === refName ||
        v.name === directValue ||
        v.name === refName ||
        normalizedVarName === refName ||
        varIdCanonical === refCanonical ||
        varNameCanonical === refCanonical ||
        normalizedNameCanonical === refCanonical
      )
    })
    if (variable) {
      return getVariableValue(variable, currentTheme)
    }
  }

  return directValue
}

/**
 * Resolve color from variable binding or use direct value
 */
export function resolveColor(
  color: string | undefined,
  binding: { variableId: string } | undefined,
  variables: Variable[],
  currentTheme: ThemeName
): string | undefined {
  return resolveVariableValue(color, binding, variables, currentTheme)
}

/**
 * Apply opacity to hex/rgb/rgba colors, returning an rgba() string when needed.
 * If opacity is 1 (or undefined), returns the original color unchanged.
 */
export function applyOpacity(color: string, opacity?: number): string {
  const a = Math.max(0, Math.min(1, opacity ?? 1))
  if (a >= 1) return color

  // rgb()/rgba()
  if (color.startsWith('rgb(') || color.startsWith('rgba(')) {
    const parts = color.match(/[\d.]+/g)
    if (parts && parts.length >= 3) {
      const r = Number(parts[0])
      const g = Number(parts[1])
      const b = Number(parts[2])
      const baseAlpha = parts.length >= 4 ? Number(parts[3]) : 1
      const outAlpha = Math.max(0, Math.min(1, baseAlpha * a))
      return `rgba(${r},${g},${b},${outAlpha})`
    }
    return color
  }

  // Hex: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
  const hex = color.replace('#', '')
  let r = 0
  let g = 0
  let b = 0
  let baseAlpha = 1
  if (hex.length === 3 || hex.length === 4) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
    if (hex.length === 4) {
      baseAlpha = parseInt(hex[3] + hex[3], 16) / 255
    }
  } else if (hex.length === 6 || hex.length === 8) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
    if (hex.length === 8) {
      baseAlpha = parseInt(hex.slice(6, 8), 16) / 255
    }
  } else {
    return color
  }

  const outAlpha = Math.max(0, Math.min(1, baseAlpha * a))
  return `rgba(${r},${g},${b},${outAlpha})`
}

/**
 * Resolve a numeric variable value from binding or use direct value
 */
export function resolveNumberVariable(
  directValue: number | undefined,
  binding: { variableId: string } | undefined,
  variables: Variable[],
  currentTheme: ThemeName
): number | undefined {
  if (binding) {
    const variable = variables.find((v) => v.id === binding.variableId)
    if (variable) {
      const val = parseFloat(getVariableValue(variable, currentTheme))
      if (!isNaN(val)) return val
    }
  }
  return directValue
}
