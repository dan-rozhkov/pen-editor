import { create } from 'zustand'
import { THEME_COLLECTION_ID, type CollectionId, type ModeContext, type ModeId, type ThemeName } from '../types/variable'

interface ThemeState {
  /** Document-level mode per collection (missing key = the collection default). */
  modeContext: ModeContext
  /** Compat mirror of `modeContext[THEME_COLLECTION_ID] ?? 'light'`. Kept in step by the store. */
  activeTheme: ThemeName

  /** Sets the context and the `activeTheme` mirror in one update. */
  setModeContext: (ctx: ModeContext) => void
  setCollectionMode: (collectionId: CollectionId, modeId: ModeId) => void
  /** Same as `setCollectionMode(THEME_COLLECTION_ID, theme)`. */
  setActiveTheme: (theme: ThemeName) => void
}

const themeOf = (ctx: ModeContext): ThemeName => (ctx[THEME_COLLECTION_ID] ?? 'light') as ThemeName

export const useThemeStore = create<ThemeState>((set, get) => ({
  modeContext: { [THEME_COLLECTION_ID]: 'light' },
  activeTheme: 'light',

  setModeContext: (ctx) => {
    const modeContext = { ...ctx }
    set({ modeContext, activeTheme: themeOf(modeContext) })
  },
  setCollectionMode: (collectionId, modeId) =>
    get().setModeContext({ ...get().modeContext, [collectionId]: modeId }),
  setActiveTheme: (theme) => get().setCollectionMode(THEME_COLLECTION_ID, theme),
}))

// Legacy callers (and tests) still write `activeTheme` with a raw setState.
// Mirror that into the context so the two can never disagree.
useThemeStore.subscribe((state, prev) => {
  if (state.activeTheme !== prev.activeTheme && state.activeTheme !== themeOf(state.modeContext)) {
    useThemeStore.setState({ modeContext: { ...state.modeContext, [THEME_COLLECTION_ID]: state.activeTheme } })
  }
})
