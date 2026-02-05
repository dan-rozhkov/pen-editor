import { Canvas } from "./components/Canvas";
import { LeftSidebar } from "./components/LeftSidebar";
import { RightSidebar } from "./components/RightSidebar";
import { PrimitivesPanel } from "./components/PrimitivesPanel";

function App() {
  return (
    <div className="w-full h-full flex flex-col">
      <div className="flex-1 flex flex-row overflow-hidden">
        <LeftSidebar />
        <div className="flex-1 h-full overflow-hidden relative">
          <Canvas />
          <PrimitivesPanel />
        </div>
        <RightSidebar />
      </div>
    </div>
  );
}

export default App;
