import { lazy, Suspense, useEffect } from "react";
import { loadModels } from "./lib/chatModels";
import { reconcileModels } from "./store/chatStore";
import { useCustomFontStore } from "./store/customFontStore";
import { LeftRail } from "./components/LeftRail";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { PresentOverlay } from "./components/PresentOverlay";
import { CommandPalette } from "./components/CommandPalette";
import { PresentController } from "./components/PresentController";
import { ReadOnlyProvider } from "./components/ReadOnlyProvider";
import { FpsDisplay } from "./components/canvas/CanvasOverlays";
import { Rulers } from "./components/canvas/Rulers";
import { CanvasContextMenu } from "./components/canvas/CanvasContextMenu";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import { useEditorModeStore } from "./store/editorModeStore";
import { useIsMobile } from "./hooks/useIsMobile";
import { useOnlineStatus } from "./hooks/useOnlineStatus";
import { OfflineBanner } from "./components/pwa/OfflineBanner";
import { PwaUpdateToast } from "./components/pwa/PwaUpdateToast";
import { Toaster } from "./components/ui/sonner";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);
  const mode = useEditorModeStore((s) => s.mode);
  const isMobile = useIsMobile();
  const isOnline = useOnlineStatus();

  const isPresent = mode === "present";
  const isView = mode === "view";

  // Pull the authoritative chat model list from the backend, then drop any saved
  // selection it no longer allows. Falls back to the hardcoded list on failure.
  useEffect(() => {
    loadModels().then(reconcileModels);
  }, []);

  // Re-register every custom (uploaded) font's FontFace with the browser so
  // text using it renders correctly after a reload, instead of falling back.
  useEffect(() => {
    useCustomFontStore.getState().restoreCustomFonts();
  }, []);

  // Read-only view mode is entered only via the `?view` URL parameter
  // (e.g. ?view or ?view=1). There is no in-app toggle.
  useEffect(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    if (view !== null && view !== "0" && view !== "false") {
      useEditorModeStore.getState().enterView();
    }
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Canvas — always full window, behind everything. `isolate` creates a
          stacking context so the embed DOM overlay (and other canvas overlays,
          which use positive z-index) stay trapped beneath the UI panels below. */}
      <div className="absolute inset-0 isolate">
        {/* CanvasContextMenu always wraps PixiCanvas — swapping this element
            based on mode would remount PixiCanvas (destroying/recreating the
            WebGL context) on every present/view toggle. The menu suppresses
            itself internally during present mode instead. */}
        <CanvasContextMenu>
          <Suspense fallback={null}>
            <PixiCanvas />
          </Suspense>
        </CanvasContextMenu>
      </div>

      {/* Keeps the present-mode frame fitted to the window; no-op otherwise. */}
      <PresentController />

      {/* Present mode hides all editor chrome and shows only the slide controls. */}
      {isPresent && <PresentOverlay />}

      {/* Offline status pill — rendered above the canvas/UI stack. Non-blocking
          (pointer-events-none), so it never intercepts canvas or sidebar
          interaction. PixiCanvas stays mounted; only backend-dependent
          features are unavailable while offline. */}
      {!isOnline && !isPresent && <OfflineBanner />}

      {/* Update-available toast — appears once a new service worker version
          has installed and is waiting to activate. Headless: it fires a sonner
          toast into the <Toaster /> portal below. */}
      {!isPresent && <PwaUpdateToast />}

      {/* Sonner toast portal (hosts PwaUpdateToast's toast). */}
      <Toaster />

      {/* Cmd+/ or Cmd+K search overlay — lists every tool/menu action from
          the command registry. Edit-mode only: its commands mutate the scene
          directly and would otherwise bypass the read-only guarantee that
          `canEditScene` enforces for view/present mode. */}
      {mode === "edit" && <CommandPalette />}

      {/* UI panels — overlay on top of canvas */}
      {!isUIHidden && !isPresent && (
        <div className="absolute inset-0 flex flex-row pointer-events-none">
          {/* Left rail + sidebar — layers panel is read-only in view mode. */}
          <div className="pointer-events-auto flex flex-row">
            <LeftRail />
            <ReadOnlyProvider value={isView}>
              <LeftSidebar />
            </ReadOnlyProvider>
          </div>
          {/* Center area — tools/right panel are hidden on mobile, which keeps
              only the left rail (and its full-width overlay panel). */}
          {!isMobile && (
            <>
              <div className="flex-1 h-full relative">
                {/* Drawing tools are pointless in read-only view mode. */}
                {!isView && (
                  <div className="pointer-events-auto">
                    <PrimitivesPanel />
                  </div>
                )}
                {!isView && <Rulers />}
                <FpsDisplay />
              </div>
              {/* Right sidebar — read-only in view mode (inspect, no edits). */}
              <div className="pointer-events-auto">
                <ReadOnlyProvider value={isView}>
                  <RightSidebar />
                </ReadOnlyProvider>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
