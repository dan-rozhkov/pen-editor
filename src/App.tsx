import { lazy, Suspense } from "react";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import { ChatPanel } from "./components/chat/ChatPanel";
import { useRendererStore } from "./store/rendererStore";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

const Canvas = lazy(() => import("./components/Canvas").then((m) => ({ default: m.Canvas })));
const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const rendererMode = useRendererStore((s) => s.rendererMode);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 flex flex-row overflow-hidden">
        <LeftSidebar />
        <div className="flex-1 h-full overflow-hidden relative">
          <Suspense fallback={null}>
            {rendererMode === "pixi" ? <PixiCanvas /> : <Canvas />}
          </Suspense>
          <PrimitivesPanel />
          <ChatPanel />
        </div>
        <RightSidebar />
      </div>
    </div>
  );
}

export default App;
