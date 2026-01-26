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
