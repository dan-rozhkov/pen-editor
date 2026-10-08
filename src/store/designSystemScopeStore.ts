import { create } from "zustand";
import { generateDesignSystemScopeId, type DesignSystemScope } from "@/types/designSystemScope";
import { sanitizeDesignSystemScopes } from "@/lib/designSystem/savedScopes";

interface DesignSystemScopeState {
  scopes: DesignSystemScope[];
  addScope: (scope: Omit<DesignSystemScope, "id">) => DesignSystemScope;
  updateScope: (id: string, updates: Partial<Omit<DesignSystemScope, "id">>) => void;
  deleteScope: (id: string) => void;
  /** Replace everything (document open / reset). Malformed entries are dropped. */
  setScopes: (scopes: DesignSystemScope[]) => void;
}

/**
 * Saved design-system scopes of the open document. They live in the `.pen`
 * file (`designSystemScopes`) and are created from the Variables panel only;
 * the agent reads them (`get_design_system { scope: { saved } }`) but cannot
 * write them. No undo history: a scope is a bookmark, not part of the design.
 */
export const useDesignSystemScopeStore = create<DesignSystemScopeState>((set) => ({
  scopes: [],

  addScope: (scope) => {
    const created: DesignSystemScope = { ...scope, id: generateDesignSystemScopeId() };
    set((state) => ({ scopes: [...state.scopes, created] }));
    return created;
  },

  updateScope: (id, updates) =>
    set((state) => {
      if (!state.scopes.some((s) => s.id === id)) return state;
      return { scopes: state.scopes.map((s) => (s.id === id ? { ...s, ...updates, id } : s)) };
    }),

  deleteScope: (id) => set((state) => ({ scopes: state.scopes.filter((s) => s.id !== id) })),

  setScopes: (scopes) => set({ scopes: sanitizeDesignSystemScopes(scopes) }),
}));
