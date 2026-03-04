import { lazy, Suspense } from "react";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { ChatPanel } from "./components/chat/ChatPanel";
import { useUIVisibilityStore } from "./store/uiVisibilityStore";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const isUIHidden = useUIVisibilityStore((s) => s.isUIHidden);

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
