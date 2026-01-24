import { create } from 'zustand'
import type { Variable, ThemeName, ThemeValues } from '../types/variable'

interface VariableState {
  variables: Variable[]

  // CRUD operations
  addVariable: (variable: Variable) => void
  updateVariable: (id: string, updates: Partial<Variable>) => void
  updateVariableThemeValue: (id: string, theme: ThemeName, value: string) => void
  deleteVariable: (id: string) => void

  // Bulk operations (for serialization)
  setVariables: (variables: Variable[]) => void
}

export const useVariableStore = create<VariableState>((set) => ({
  variables: [],

  addVariable: (variable) =>
    set((state) => ({
      variables: [...state.variables, variable],
    })),

  updateVariable: (id, updates) =>
    set((state) => ({
      variables: state.variables.map((v) =>
        v.id === id ? { ...v, ...updates } : v
      ),
    })),

  updateVariableThemeValue: (id, theme, value) =>
    set((state) => ({
      variables: state.variables.map((v) => {
        if (v.id !== id) return v
        const themeValues: ThemeValues = v.themeValues ?? {
          light: v.value,
          dark: v.value,
        }
        return {
          ...v,
          themeValues: { ...themeValues, [theme]: value },
          value: theme === 'dark' ? value : v.value, // Keep value in sync with dark theme
        }
      }),
    })),

  deleteVariable: (id) =>
    set((state) => ({
      variables: state.variables.filter((v) => v.id !== id),
    })),

  setVariables: (variables) => set({ variables }),
}))
