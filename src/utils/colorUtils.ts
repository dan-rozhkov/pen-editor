import type { Variable, ThemeName } from '../types/variable'
import { getVariableValue } from '../types/variable'

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
 * Apply opacity to a hex color, returning an rgba() string.
 * If opacity is 1 (or undefined), returns the original color unchanged.
 */
export function applyOpacity(color: string, opacity?: number): string {
  const a = opacity ?? 1
  if (a >= 1) return color
  // Parse hex color
  const hex = color.replace('#', '')
  let r = 0, g = 0, b = 0
  if (hex.length === 3) {
    r = parseInt(hex[0] + hex[0], 16)
    g = parseInt(hex[1] + hex[1], 16)
    b = parseInt(hex[2] + hex[2], 16)
  } else if (hex.length >= 6) {
    r = parseInt(hex.slice(0, 2), 16)
    g = parseInt(hex.slice(2, 4), 16)
    b = parseInt(hex.slice(4, 6), 16)
  }
  return `rgba(${r},${g},${b},${a})`
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
