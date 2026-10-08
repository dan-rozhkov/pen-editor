import { create } from 'zustand'
import type {
  CollectionId,
  ModeId,
  ThemeName,
  Variable,
  VariableCollection,
  VariableModeValue,
} from '../types/variable'
import { THEME_COLLECTION_ID } from '../types/variable'
import {
  buildVariableIndex,
  collectionIdOf,
  finalizeVariables,
  makeThemeCollection,
  modeValuesOf,
  resolveVariable,
  applyVariablePatch,
  remapToCollection,
  upgradeVariablesV2,
  wouldCreateCycle,
  ensureThemeCollection,
} from '../lib/variables'
import { useHistoryStore } from './historyStore'
import { useSceneStore, createSnapshot } from './sceneStore'

interface VariableState {
  variables: Variable[]
  collections: VariableCollection[]

  // CRUD operations
  addVariable: (variable: Variable) => void
  /**
   * Returns false (and changes nothing) for an unknown id, an alias cycle or
   * type mismatch, a `type` change that breaks aliases, or an unknown collection.
   * A `collectionId` change remaps modes like `moveVariableToCollection`.
   */
  updateVariable: (id: string, updates: Partial<Variable>) => boolean
  /**
   * Legacy light/dark wrapper over `setVariableModeValue`. For a variable in a
   * non-Theme collection, `light` means the collection's default mode and `dark`
   * its first non-default mode (the default if there is only one).
   */
  updateVariableThemeValue: (id: string, theme: ThemeName, value: string) => boolean
  /** Returns false (and changes nothing) for a cycle, a type mismatch or an unknown id/mode. */
  setVariableModeValue: (id: string, modeId: ModeId, value: VariableModeValue) => boolean
  deleteVariable: (id: string) => void

  // Collections and modes. Boolean results: false = refused, nothing changed.
  addCollection: (name: string, modeNames?: string[]) => CollectionId
  renameCollection: (id: CollectionId, name: string) => void
  deleteCollection: (id: CollectionId) => boolean
  addMode: (collectionId: CollectionId, name: string) => ModeId | null
  renameMode: (collectionId: CollectionId, modeId: ModeId, name: string) => void
  deleteMode: (collectionId: CollectionId, modeId: ModeId) => boolean
  setDefaultMode: (collectionId: CollectionId, modeId: ModeId) => boolean
  moveVariableToCollection: (id: string, collectionId: CollectionId) => boolean

  // Bulk operations (for serialization). Not undoable user edits. Both always
  // normalize: legacy shapes are upgraded and the compat mirrors recomputed.
  setVariables: (variables: Variable[]) => void
  setCollections: (collections: VariableCollection[]) => void
  /** Replace variables and (when given) collections in one update; used by undo/redo restore. */
  replaceAll: (variables: Variable[], collections?: VariableCollection[]) => void
}

/**
 * Record an undo snapshot before a variable edit. The snapshot captures the
 * whole editor state (scene + selection + current variables and collections),
 * so undo/redo round-trips variable add/update/delete the same way it does
 * scene edits.
 */
function saveVariableHistory(): void {
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()))
}

function randomId(prefix: string): string {
  return prefix + Math.random().toString(36).substring(2, 9)
}

/** Upgrade + finalize in one go: the single normalizing boundary of the store. */
function normalized(
  variables: unknown[],
  collections: VariableCollection[],
): { variables: Variable[]; collections: VariableCollection[] } {
  return upgradeVariablesV2(variables, collections)
}

export const useVariableStore = create<VariableState>((set, get) => {
  /** Apply a variables transform, then finalize against the (possibly new) collections. */
  const commit = (
    variables: Variable[],
    collections: VariableCollection[] = get().collections,
  ): void => {
    set({ variables: finalizeVariables(variables, collections), collections })
  }

  return {
    variables: [],
    collections: [makeThemeCollection()],

    addVariable: (variable) => {
      saveVariableHistory()
      const { variables, collections } = get()
      const [added] = normalized([variable], collections).variables
      if (!added) return
      commit([...variables, added])
    },

    updateVariable: (id, updates) => {
      const { variables, collections } = get()
      const next = applyVariablePatch(variables, collections, id, updates)
      if (!next) return false
      saveVariableHistory()
      commit(variables.map((v) => (v.id === id ? next : v)))
      return true
    },

    setVariableModeValue: (id, modeId, value) => {
      const { variables, collections } = get()
      const target = variables.find((v) => v.id === id)
      if (!target) return false
      const collection = collections.find((c) => c.id === collectionIdOf(target))
      if (collection && !collection.modes.some((m) => m.id === modeId)) return false
      if (typeof value !== 'string') {
        const index = buildVariableIndex(variables, collections)
        const aliased = index.byId.get(value.alias)
        if (!aliased || aliased.type !== target.type) return false
        if (wouldCreateCycle(index, id, value.alias)) return false
      }
      saveVariableHistory()
      commit(
        variables.map((v) =>
          v.id === id ? { ...v, valuesByMode: { ...modeValuesOf(v), [modeId]: value } } : v,
        ),
      )
      return true
    },

    updateVariableThemeValue: (id, theme, value) => {
      const { variables, collections } = get()
      const target = variables.find((v) => v.id === id)
      if (!target) return false
      const cid = collectionIdOf(target)
      const collection = collections.find((c) => c.id === cid)
      if (cid === THEME_COLLECTION_ID || !collection) {
        return get().setVariableModeValue(id, theme, value)
      }
      const nonDefault = collection.modes.find((m) => m.id !== collection.defaultModeId)
      const modeId = theme === 'dark' ? (nonDefault?.id ?? collection.defaultModeId) : collection.defaultModeId
      return get().setVariableModeValue(id, modeId, value)
    },

    deleteVariable: (id) => {
      saveVariableHistory()
      const { variables, collections } = get()
      const index = buildVariableIndex(variables, collections)
      const next: Variable[] = []
      for (const v of variables) {
        if (v.id === id) continue
        let out = v
        const aliasesIt = Object.values(modeValuesOf(v)).some((e) => typeof e !== 'string' && e.alias === id)
        if (aliasesIt || v.deprecated?.replacedBy === id) {
          const cid = collectionIdOf(v)
          const modes = modeValuesOf(v)
          const rewritten: Record<ModeId, VariableModeValue> = {}
          for (const [modeId, entry] of Object.entries(modes)) {
            if (typeof entry !== 'string' && entry.alias === id) {
              const r = resolveVariable(index, id, { [cid]: modeId })
              rewritten[modeId] = r.ok ? r.value : (index.byId.get(id)?.value ?? '')
            } else {
              rewritten[modeId] = entry
            }
          }
          out = { ...v, valuesByMode: rewritten }
          if (v.deprecated?.replacedBy === id) {
            const { replacedBy: _dropped, ...rest } = v.deprecated
            void _dropped
            out = { ...out, deprecated: rest }
          }
        }
        next.push(out)
      }
      commit(next)
    },

    addCollection: (name, modeNames = ['Mode 1']) => {
      saveVariableHistory()
      const modes = (modeNames.length > 0 ? modeNames : ['Mode 1']).map((n) => ({ id: randomId('mode_'), name: n }))
      const collection: VariableCollection = {
        id: randomId('col_'),
        name,
        modes,
        defaultModeId: modes[0].id,
      }
      commit(get().variables, [...get().collections, collection])
      return collection.id
    },

    renameCollection: (id, name) => {
      saveVariableHistory()
      set((s) => ({ collections: s.collections.map((c) => (c.id === id ? { ...c, name } : c)) }))
    },

    deleteCollection: (id) => {
      const { variables, collections } = get()
      if (id === THEME_COLLECTION_ID) return false
      if (!collections.some((c) => c.id === id)) return false
      // Refuse rather than orphan or silently move variables: the caller decides.
      if (variables.some((v) => collectionIdOf(v) === id)) return false
      saveVariableHistory()
      commit(variables, collections.filter((c) => c.id !== id))
      return true
    },

    addMode: (collectionId, name) => {
      const { variables, collections } = get()
      const collection = collections.find((c) => c.id === collectionId)
      if (!collection) return null
      saveVariableHistory()
      const mode = { id: randomId('mode_'), name }
      commit(
        variables.map((v) => {
          if (collectionIdOf(v) !== collectionId) return v
          const modes = modeValuesOf(v)
          const seed = modes[collection.defaultModeId]
          return seed === undefined ? v : { ...v, valuesByMode: { ...modes, [mode.id]: seed } }
        }),
        collections.map((c) => (c.id === collectionId ? { ...c, modes: [...c.modes, mode] } : c)),
      )
      return mode.id
    },

    renameMode: (collectionId, modeId, name) => {
      saveVariableHistory()
      set((s) => ({
        collections: s.collections.map((c) =>
          c.id === collectionId
            ? { ...c, modes: c.modes.map((m) => (m.id === modeId ? { ...m, name } : m)) }
            : c,
        ),
      }))
    },

    deleteMode: (collectionId, modeId) => {
      const { variables, collections } = get()
      const collection = collections.find((c) => c.id === collectionId)
      if (!collection || !collection.modes.some((m) => m.id === modeId)) return false
      // The Theme collection's light/dark are structural (the compat mirrors need them).
      if (collectionId === THEME_COLLECTION_ID) return false
      if (collection.defaultModeId === modeId || collection.modes.length <= 1) return false
      saveVariableHistory()
      commit(
        variables.map((v) => {
          if (collectionIdOf(v) !== collectionId) return v
          const { [modeId]: _gone, ...rest } = modeValuesOf(v)
          void _gone
          return { ...v, valuesByMode: rest }
        }),
        collections.map((c) =>
          c.id === collectionId ? { ...c, modes: c.modes.filter((m) => m.id !== modeId) } : c,
        ),
      )
      return true
    },

    setDefaultMode: (collectionId, modeId) => {
      const { variables, collections } = get()
      const collection = collections.find((c) => c.id === collectionId)
      if (!collection || !collection.modes.some((m) => m.id === modeId)) return false
      if (collectionId === THEME_COLLECTION_ID) return false
      saveVariableHistory()
      commit(
        variables,
        collections.map((c) => (c.id === collectionId ? { ...c, defaultModeId: modeId } : c)),
      )
      return true
    },

    moveVariableToCollection: (id, collectionId) => {
      const { variables, collections } = get()
      const target = collections.find((c) => c.id === collectionId)
      const variable = variables.find((v) => v.id === id)
      if (!target || !variable) return false
      if (collectionIdOf(variable) === collectionId) return true
      saveVariableHistory()
      const moved = remapToCollection(variables, collections, variable, target)
      commit(variables.map((v) => (v.id === id ? moved : v)))
      return true
    },

    // Bulk replace (document load / serialization) — not an undoable user edit.
    setVariables: (variables) => {
      const next = normalized(variables, get().collections)
      set({ variables: next.variables, collections: next.collections })
    },

    setCollections: (collections) => {
      const next = normalized(get().variables, ensureThemeCollection(collections))
      set({ variables: next.variables, collections: next.collections })
    },

    replaceAll: (variables, collections) => {
      const next = normalized(variables, collections ?? get().collections)
      set({ variables: next.variables, collections: next.collections })
    },
  }
})
