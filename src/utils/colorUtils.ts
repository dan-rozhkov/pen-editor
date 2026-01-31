import type { Variable, ThemeName } from '../types/variable'
import { getVariableValue } from '../types/variable'

/**
 * Resolve color from variable binding or use direct value
 */
export function resolveColor(
  color: string | undefined,
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
  return color
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
  return directValue
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
