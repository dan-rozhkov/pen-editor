import { create } from 'zustand'
import type { Variable, ThemeName, ThemeValues } from '../types/variable'
import { useHistoryStore } from './historyStore'
import { useSceneStore, createSnapshot } from './sceneStore'

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

/**
 * Record an undo snapshot before a variable edit. The snapshot captures the
 * whole editor state (scene + selection + current variables), so undo/redo
 * round-trips variable add/update/delete the same way it does scene edits.
 */
function saveVariableHistory(): void {
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()))
}

export const useVariableStore = create<VariableState>((set) => ({
  variables: [],

  addVariable: (variable) => {
    saveVariableHistory()
    set((state) => ({
      variables: [...state.variables, variable],
    }))
  },

  updateVariable: (id, updates) => {
    saveVariableHistory()
    set((state) => ({
      variables: state.variables.map((v) =>
        v.id === id ? { ...v, ...updates } : v
      ),
    }))
  },

  updateVariableThemeValue: (id, theme, value) => {
    saveVariableHistory()
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
    }))
  },

  deleteVariable: (id) => {
    saveVariableHistory()
    set((state) => ({
      variables: state.variables.filter((v) => v.id !== id),
    }))
  },

  // Bulk replace (document load / serialization) — not an undoable user edit.
  setVariables: (variables) => set({ variables }),
}))
