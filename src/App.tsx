import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { LayersPanel } from './components/LayersPanel'
import './App.css'

function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="canvas-container">
        <Canvas />
      </div>
      <LayersPanel />
    </div>
  )
}

export default App
