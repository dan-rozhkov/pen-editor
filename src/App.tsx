import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import './App.css'

function App() {
  return (
    <div className="app">
      <Toolbar />
      <div className="canvas-container">
        <Canvas />
      </div>
    </div>
  )
}

export default App
