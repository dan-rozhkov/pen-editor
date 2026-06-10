import { lazy, Suspense, useEffect } from "react";
import { loadModels } from "./lib/chatModels";
import { reconcileModels } from "./store/chatStore";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { ChatPanel } from "./components/chat/ChatPanel";
import { FpsDisplay } from "./components/canvas/CanvasOverlays";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import { useFloatingPanelsStore } from "./store/floatingPanelsStore";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);
  const isFloating = useFloatingPanelsStore((s) => s.isFloating);

  // Pull the authoritative chat model list from the backend, then drop any saved
  // selection it no longer allows. Falls back to the hardcoded list on failure.
  useEffect(() => {
    loadModels().then(reconcileModels);
  }, []);

  return (
    <div className="w-full h-full relative overflow-hidden">
      {/* Canvas — always full window, behind everything */}
      <div className="absolute inset-0">
        <Suspense fallback={null}>
          <PixiCanvas />
        </Suspense>
      </div>
      {/* UI panels — overlay on top of canvas */}
      {!isUIHidden && (
        <div className="absolute inset-0 flex flex-row pointer-events-none">
          {/* Left sidebar */}
          <div
            className={
              isFloating
                ? "pointer-events-auto absolute left-5 top-5 z-20"
                : "pointer-events-auto"
            }
          >
            <LeftSidebar />
          </div>
          {/* Center area */}
          <div className={isFloating ? "flex-1 h-full relative" : "flex-1 h-full relative"}>
            <div className="pointer-events-auto">
              <PrimitivesPanel />
            </div>
            <div className="pointer-events-auto">
              <ChatPanel />
            </div>
            <FpsDisplay />
          </div>
          {/* Right sidebar */}
          <div
            className={
              isFloating
                ? "pointer-events-auto absolute right-5 top-5 bottom-5 z-20"
                : "pointer-events-auto"
            }
          >
            <RightSidebar />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
