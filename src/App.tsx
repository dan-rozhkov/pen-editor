import { lazy, Suspense, useEffect } from "react";
import { loadModels } from "./lib/chatModels";
import { reconcileModels } from "./store/chatStore";
import { LeftRail } from "./components/LeftRail";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { FpsDisplay } from "./components/canvas/CanvasOverlays";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import { useIsMobile } from "./hooks/useIsMobile";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);
  const isMobile = useIsMobile();

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
      {/* UI panels — overlay on top of canvas */}
      {!isUIHidden && (
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
                <div className="pointer-events-auto">
                  <PrimitivesPanel />
                </div>
                <FpsDisplay />
              </div>
              {/* Right sidebar */}
              <div className="pointer-events-auto">
                <RightSidebar />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
