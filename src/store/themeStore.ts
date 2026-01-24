import { create } from 'zustand'
import type { ThemeName } from '../types/variable'

interface ThemeState {
  activeTheme: ThemeName

  setActiveTheme: (theme: ThemeName) => void
}

export const useThemeStore = create<ThemeState>((set) => ({
  activeTheme: 'dark',

  setActiveTheme: (theme) => set({ activeTheme: theme }),
}))
