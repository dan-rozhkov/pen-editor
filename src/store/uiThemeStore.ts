import { create } from 'zustand'
import {
  applyUITheme,
  getStoredUITheme,
  UI_THEME_STORAGE_KEY,
  type UITheme,
} from '@/lib/uiTheme'
import { useSceneStore } from './sceneStore'

const PAGE_BG_LIGHT = '#f5f5f5'
const PAGE_BG_DARK = '#1a1a1a'

function applyThemeWithoutTransitions(theme: UITheme) {
  const root = document.documentElement
  root.classList.add('disable-theme-transitions')
  // Apply the new theme while `transition: none` (from
  // `disable-theme-transitions`) is in effect, then force a synchronous
  // style recalc/layout *before* the class is removed. If we instead forced
  // the reflow first and applied the theme after, the class-add, the theme
  // mutation and the rAF-scheduled class removal could all be coalesced
  // into a single style recalc by the browser — meaning the very first
  // recalc the browser performs would already see both the new theme values
  // and `disable-theme-transitions` removed, so the transition would run
  // anyway. Reading a layout property (`offsetHeight`) here, after
  // `applyUITheme` and before the class removal, forces the browser to
  // flush style/layout with the new theme applied and transitions still
  // disabled, splitting the theme mutation from the class removal into two
  // distinct recalcs. Do not remove this as "dead code" — it has no visible
  // effect in the diff but is required for correctness.
  applyUITheme(theme)
  void root.offsetHeight
  requestAnimationFrame(() => {
    root.classList.remove('disable-theme-transitions')
  })
}

interface UIThemeState {
  uiTheme: UITheme
  setUITheme: (theme: UITheme) => void
  toggleUITheme: () => void
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
    setUITheme: (theme) => set({ uiTheme: theme }),
    toggleUITheme: () => {
      const next = get().uiTheme === 'light' ? 'dark' : 'light'
      set({ uiTheme: next })
    },
  }
})

useUIThemeStore.subscribe((state, prev) => {
  if (state.uiTheme !== prev.uiTheme) {
    applyThemeWithoutTransitions(state.uiTheme)
  } else {
    applyUITheme(state.uiTheme)
  }
  localStorage.setItem(UI_THEME_STORAGE_KEY, state.uiTheme)
  if (state.uiTheme !== prev.uiTheme) {
    const scene = useSceneStore.getState()
    const oldDefault = prev.uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT
    if (scene.pageBackground === oldDefault) {
      scene.setPageBackground(state.uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT)
    }
  }
})
