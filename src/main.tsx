import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { registerServiceWorker } from '@/pwa/registerServiceWorker'

import './index.css'
import App from './App.tsx'

// vite-plugin-pwa's generateSW output only exists for production builds
// (no devOptions are enabled), so only register there.
if (import.meta.env.PROD) {
  registerServiceWorker()
}

// Dev-only: expose internals for E2E testing
if (import.meta.env.DEV) {
  import('@/lib/toolRegistry').then(({ toolHandlers }) => {
    (window as unknown as Record<string, unknown>).__toolHandlers = toolHandlers;
  });
  import('@/store/sceneStore').then(({ useSceneStore }) => {
    (window as unknown as Record<string, unknown>).__sceneStore = useSceneStore;
  });
  import('@/store/historyStore').then(({ useHistoryStore }) => {
    (window as unknown as Record<string, unknown>).__historyStore = useHistoryStore;
  });
  import('@/store/themeStore').then(({ useThemeStore }) => {
    (window as unknown as Record<string, unknown>).__themeStore = useThemeStore;
  });
  import('@/store/pwaStore').then(({ usePwaStore }) => {
    (window as unknown as Record<string, unknown>).__pwaStore = usePwaStore;
  });
  import('@/store/variableStore').then(({ useVariableStore }) => {
    (window as unknown as Record<string, unknown>).__variableStore = useVariableStore;
  });
  import('@/store/selectionStore').then(({ useSelectionStore }) => {
    (window as unknown as Record<string, unknown>).__selectionStore = useSelectionStore;
  });
  import('@/store/viewportStore').then(({ useViewportStore }) => {
    (window as unknown as Record<string, unknown>).__viewportStore = useViewportStore;
  });
  import('@/store/editorModeStore').then(({ useEditorModeStore }) => {
    (window as unknown as Record<string, unknown>).__editorModeStore = useEditorModeStore;
  });
  import('@/store/canvasRefStore').then(({ useCanvasRefStore }) => {
    (window as unknown as Record<string, unknown>).__canvasRefStore = useCanvasRefStore;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
