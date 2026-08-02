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
  applyUITheme(theme)
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
