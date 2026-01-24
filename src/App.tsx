import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { LayersPanel } from './components/LayersPanel'

function App() {
  return (
    <div className="w-full h-full flex flex-row">
      <Toolbar />
      <div className="flex-1 h-full overflow-hidden">
        <Canvas />
      </div>
      <LayersPanel />
    </div>
  )
}

export default App
