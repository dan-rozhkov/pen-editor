import { create } from 'zustand'
import type { Variable } from '../types/variable'

interface VariableState {
  variables: Variable[]

  // CRUD operations
  addVariable: (variable: Variable) => void
  updateVariable: (id: string, updates: Partial<Variable>) => void
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

  deleteVariable: (id) =>
    set((state) => ({
      variables: state.variables.filter((v) => v.id !== id),
    })),

  setVariables: (variables) => set({ variables }),
}))
