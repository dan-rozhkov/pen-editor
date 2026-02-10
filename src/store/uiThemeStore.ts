import { create } from 'zustand'
import { useSceneStore } from './sceneStore'

type UITheme = 'light' | 'dark'

const STORAGE_KEY = 'ui-theme'
const PAGE_BG_LIGHT = '#f5f5f5'
const PAGE_BG_DARK = '#1a1a1a'

function getInitialTheme(): UITheme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark'
  return 'light'
}

function applyTheme(theme: UITheme) {
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

function applyThemeWithoutTransitions(theme: UITheme) {
  const root = document.documentElement
  root.classList.add('disable-theme-transitions')
  applyTheme(theme)
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
  const initial = getInitialTheme()
  applyTheme(initial)
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
    applyTheme(state.uiTheme)
  }
  localStorage.setItem(STORAGE_KEY, state.uiTheme)
  if (state.uiTheme !== prev.uiTheme) {
    const scene = useSceneStore.getState()
    const oldDefault = prev.uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT
    if (scene.pageBackground === oldDefault) {
      scene.setPageBackground(state.uiTheme === 'dark' ? PAGE_BG_DARK : PAGE_BG_LIGHT)
    }
  }
})
