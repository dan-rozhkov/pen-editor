import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { RootErrorBoundary } from '@/components/RootErrorBoundary'
import { startBridges } from '@/lib/bridgeBootstrap'
import { applyStoredUITheme } from '@/lib/uiTheme'
import { registerServiceWorker } from '@/pwa/registerServiceWorker'
import { recoverFromFatalError } from '@/pwa/updateSelfHeal'

import './index.css'
import { AppRouter } from './AppRouter'

// Both routes share the editor's persisted UI preference. Applying the tiny,
// dependency-free theme bootstrap here keeps the showcase out of the editor
// store graph while still preventing a light flash on a direct dark visit.
applyStoredUITheme()

// vite-plugin-pwa's generateSW output only exists for production builds
// (no devOptions are enabled), so only register there.
if (import.meta.env.PROD) {
  registerServiceWorker()
}

// RootErrorBoundary only catches crashes that happen *during React's render*.
// By ES module semantics, every static import above this line (RootErrorBoundary,
// registerServiceWorker, updateSelfHeal, AppRouter, index.css) has already
// finished evaluating by the time this listener is registered, so it cannot
// catch a crash while THIS module or its static imports are still evaluating
// — catching that would need an inline script in index.html, which is
// deliberately out of scope here. What it *does* catch: a crash while
// evaluating a module loaded via dynamic `import()` after this point (the
// editor itself, since AppRouter lazy-loads App), and any async error thrown
// before React's first commit. Guarded to production only (mirrors
// registerServiceWorker above — there's no service worker to recover from in
// dev) and to an empty #root specifically, so a later, unrelated runtime
// error in a fully-mounted app doesn't reload a live session out from under
// the user.
if (import.meta.env.PROD) {
  window.addEventListener('error', () => {
    if (!document.getElementById('root')?.childElementCount) {
      recoverFromFatalError()
    }
  })
}

// See bridgeBootstrap.ts for the desktop/websocket MCP bridge startup
// ordering and its failure-falls-back-not-silently-disables contract.
startBridges()

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
  // Raster-cache correctness e2e (Task 13) samples pixels via
  // `renderer.extract.pixels({ frame })`, which requires a real `Rectangle`
  // instance (a duck-typed {x,y,width,height} object lacks `copyTo`).
  import('pixi.js').then(({ Rectangle }) => {
    (window as unknown as Record<string, unknown>).__PixiRectangle = Rectangle;
  });
  // Plugin runtime e2e (plg-01): run/stop a plugin in a real sandboxed iframe.
  import('@/lib/plugins/pluginHost').then(({ runPlugin, stopPlugin }) => {
    (window as unknown as Record<string, unknown>).__pluginHost = { runPlugin, stopPlugin };
  });
  // AI plugin generation e2e (plg-03): inspect installed plugins and the
  // command palette entries create_plugin/update_plugin produce.
  import('@/store/pluginStore').then(({ usePluginStore }) => {
    (window as unknown as Record<string, unknown>).__pluginStore = usePluginStore;
  });
  import('@/lib/commands/registry').then(({ getCommands }) => {
    (window as unknown as Record<string, unknown>).__getCommands = getCommands;
  });
  // Streaming AI vector drawing e2e (Task 8): assert the transient preview
  // draft (points/geometry/phase) exists BEFORE the tool's final input lands.
  import('@/store/aiVectorPreviewStore').then(({ useAiVectorPreviewStore }) => {
    (window as unknown as Record<string, unknown>).__aiVectorPreviewStore = useAiVectorPreviewStore;
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AppRouter />
    </RootErrorBoundary>
  </StrictMode>,
)
