import { lazy, Suspense, useEffect } from "react";
import { loadModels } from "./lib/chatModels";
import { reconcileModels } from "./store/chatStore";
import { LeftRail } from "./components/LeftRail";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { ModeToolbar } from "./components/ModeToolbar";
import { PresentOverlay } from "./components/PresentOverlay";
import { PresentController } from "./components/PresentController";
import { ReadOnlyProvider } from "./components/ReadOnlyProvider";
import { FpsDisplay } from "./components/canvas/CanvasOverlays";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import { useEditorModeStore } from "./store/editorModeStore";
import { useIsMobile } from "./hooks/useIsMobile";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);
  const mode = useEditorModeStore((s) => s.mode);
  const isMobile = useIsMobile();

  const isPresent = mode === "present";
  const isView = mode === "view";

  // Pull the authoritative chat model list from the backend, then drop any saved
  // selection it no longer allows. Falls back to the hardcoded list on failure.
  useEffect(() => {
    loadModels().then(reconcileModels);
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Canvas — always full window, behind everything. `isolate` creates a
          stacking context so the embed DOM overlay (and other canvas overlays,
          which use positive z-index) stay trapped beneath the UI panels below. */}
      <div className="absolute inset-0 isolate">
        <Suspense fallback={null}>
          <PixiCanvas />
        </Suspense>
      </div>

      {/* Keeps the present-mode frame fitted to the window; no-op otherwise. */}
      <PresentController />

      {/* Present mode hides all editor chrome and shows only the slide controls. */}
      {isPresent && <PresentOverlay />}

      {/* UI panels — overlay on top of canvas */}
      {!isUIHidden && !isPresent && (
        <div className="absolute inset-0 flex flex-row pointer-events-none">
          {/* Left rail + sidebar */}
          <div className="pointer-events-auto flex flex-row">
            <LeftRail />
            <LeftSidebar />
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
                <FpsDisplay />
                <div className="pointer-events-auto">
                  <ModeToolbar />
                </div>
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
