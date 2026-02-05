import { Canvas } from "./components/Canvas";
import { PixiCanvas } from "./pixi/PixiCanvas";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";

const USE_PIXI = localStorage.getItem("use-pixi") === "1";

function App() {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 flex flex-row overflow-hidden">
        <LeftSidebar />
        <div className="flex-1 h-full overflow-hidden relative">
          {USE_PIXI ? <PixiCanvas /> : <Canvas />}
          <PrimitivesPanel />
        </div>
        <RightSidebar />
      </div>
    </div>
  );
}

export default App;
