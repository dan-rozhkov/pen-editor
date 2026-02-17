import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

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
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
