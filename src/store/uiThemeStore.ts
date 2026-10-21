import { create } from 'zustand'
import {
  applyUITheme,
  getStoredUITheme,
  applyThemeWithoutTransitions,
  postUserTheme,
  setUIThemeStateSetter,
  UI_THEME_STORAGE_KEY,
  type UITheme,
} from '@/lib/uiTheme'
import { useSceneStore } from './sceneStore'

const PAGE_BG_LIGHT = '#f5f5f5'
const PAGE_BG_DARK = '#1a1a1a'

// A theme the embed widget's host forces on the editor chrome. While set it
// wins over every other setUITheme caller (e.g. opening/restoring a document
// applies the theme it was saved with), and nothing is written to the user's
// stored preference.
let lockedTheme: UITheme | null = null


/** Pin the live UI (store + DOM) to `theme` without saving it as the user's preference. */
export function setUIThemeTransient(theme: UITheme) {
  lockedTheme = theme
  useUIThemeStore.getState().setUITheme(theme)
  syncDefaultPageBackground()
}

/**
 * A document may carry the other theme's default page background (e.g. one
 * restored after the host theme was applied). Like a theme switch in the app,
 * a default background follows the current UI theme; a custom one is kept.
 */
export function syncDefaultPageBackground() {
  const scene = useSceneStore.getState()
  const wanted = useUIThemeStore.getState().uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT
  const current = scene.pageBackground.toLowerCase()
  if ((current === PAGE_BG_LIGHT || current === PAGE_BG_DARK) && current !== wanted) {
    scene.setPageBackground(wanted)
  }
}

/**
 * Who asked for the change - this decides persistence (the action does it):
 * - "user": an explicit choice (menu, palette); always written, even if the
 *   state already equals it (a stale tab must still publish the choice).
 * - "document": applied from a document being opened; written only on a change.
 * - "remote": followed from another document; never written.
 */
export type ThemeSource = 'user' | 'document' | 'remote'

interface UIThemeState {
  uiTheme: UITheme
  setUITheme: (theme: UITheme, opts?: { source?: ThemeSource }) => void
  toggleUITheme: () => void
}

function persistTheme(theme: UITheme, source: ThemeSource, changed: boolean) {
  if (lockedTheme || source === 'remote') return
  if (source === 'user' || changed) localStorage.setItem(UI_THEME_STORAGE_KEY, theme)
  if (source === 'user') postUserTheme(theme)
}

export const useUIThemeStore = create<UIThemeState>((set, get) => {
  const initial = getStoredUITheme()
  applyUITheme(initial)
  // Sync page background with initial theme (deferred to avoid circular init)
  queueMicrotask(() => {
    const scene = useSceneStore.getState()
    const expected = initial === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT
    if (scene.pageBackground === PAGE_BG_LIGHT || scene.pageBackground === PAGE_BG_DARK) {
      scene.setPageBackground(expected)
    }
  })

  return {
    uiTheme: initial,
    setUITheme: (theme, opts) => {
      const source = opts?.source ?? 'document'
      const prev = get().uiTheme
      set({ uiTheme: lockedTheme ?? theme })
      persistTheme(get().uiTheme, source, get().uiTheme !== prev)
    },
    toggleUITheme: () => {
      if (lockedTheme) return
      const next = get().uiTheme === 'light' ? 'dark' : 'light'
      set({ uiTheme: next })
      persistTheme(next, 'user', true)
    },
  }
})

useUIThemeStore.subscribe((state, prev) => {
  if (state.uiTheme !== prev.uiTheme) {
    applyThemeWithoutTransitions(state.uiTheme)
  } else {
    applyUITheme(state.uiTheme)
  }
  if (state.uiTheme !== prev.uiTheme) {
    const scene = useSceneStore.getState()
    const oldDefault = prev.uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT
    if (scene.pageBackground === oldDefault) {
      scene.setPageBackground(state.uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT)
    }
  }
})

// Remote themes (see installUIThemeStorageSync) follow without persisting and
// never override a host-forced transient theme.
setUIThemeStateSetter((theme) => useUIThemeStore.getState().setUITheme(theme, { source: 'remote' }))
