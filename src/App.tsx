import { lazy, Suspense } from "react";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { ChatPanel } from "./components/chat/ChatPanel";
import { ZoomIndicator, FpsDisplay } from "./components/canvas/CanvasOverlays";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import { useViewportStore } from "./store/viewportStore";
import { useSceneStore } from "./store/sceneStore";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);
  const scale = useViewportStore((s) => s.scale);
  const fitToContent = useViewportStore((s) => s.fitToContent);
  const nodes = useSceneStore((s) => s.getNodes());

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
          <div className="pointer-events-auto">
            <LeftSidebar />
          </div>
          <div className="flex-1 h-full relative">
            <div className="pointer-events-auto">
              <PrimitivesPanel />
            </div>
            <div className="pointer-events-auto">
              <ChatPanel />
            </div>
            {/* Canvas badges — positioned relative to the area between sidebars */}
            <ZoomIndicator
              scale={scale}
              onFitToContent={() => fitToContent(nodes, window.innerWidth, window.innerHeight)}
            />
            <FpsDisplay />
          </div>
          <div className="pointer-events-auto">
            <RightSidebar />
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
