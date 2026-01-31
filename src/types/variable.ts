export type VariableType = 'color' | 'number' | 'string'
export type ThemeName = 'light' | 'dark'

export interface ThemeValues {
  light: string
  dark: string
}

export interface Variable {
  id: string
  name: string
  type: VariableType
  value: string // hex color "#RRGGBB" - kept for backward compat
  themeValues?: ThemeValues
}

export function generateVariableId(): string {
  return 'var_' + Math.random().toString(36).substring(2, 9)
}

// Get the effective value for a specific theme
export function getVariableValue(variable: Variable, theme: ThemeName): string {
  if (variable.themeValues) {
    return variable.themeValues[theme]
  }
  return variable.value
}

// Ensure variable has theme values (migration helper)
export function ensureThemeValues(variable: Variable): Variable {
  if (!variable.themeValues) {
    return {
      ...variable,
      themeValues: {
        light: variable.value,
        dark: variable.value,
      },
    }
  }
  return variable
}
