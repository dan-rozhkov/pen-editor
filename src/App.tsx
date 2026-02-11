import { lazy, Suspense, useEffect, useState } from "react";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";
import "./store/uiThemeStore"; // Initialize UI theme (applies .dark class before first render)

export type RendererMode = "konva" | "pixi";

const RENDERER_STORAGE_KEY = "use-pixi";
const Canvas = lazy(() => import("./components/Canvas").then((m) => ({ default: m.Canvas })));
const PixiCanvas = lazy(() => import("./pixi/PixiCanvas").then((m) => ({ default: m.PixiCanvas })));

function App() {
  const [rendererMode, setRendererMode] = useState<RendererMode>(() =>
    localStorage.getItem(RENDERER_STORAGE_KEY) === "1" ? "pixi" : "konva"
  );

  useEffect(() => {
    localStorage.setItem(RENDERER_STORAGE_KEY, rendererMode === "pixi" ? "1" : "0");
  }, [rendererMode]);

  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 flex flex-row overflow-hidden">
        <LeftSidebar />
        <div className="flex-1 h-full overflow-hidden relative">
          <Suspense fallback={null}>
            {rendererMode === "pixi" ? <PixiCanvas /> : <Canvas />}
          </Suspense>
          <PrimitivesPanel />
        </div>
        <RightSidebar
          rendererMode={rendererMode}
          onRendererModeChange={setRendererMode}
        />
      </div>
    </div>
  );
}

export default App;
