import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { RightSidebar } from './components/RightSidebar'

function App() {
  return (
    <div className="w-full h-full flex flex-row">
      <Toolbar />
      <div className="flex-1 h-full overflow-hidden">
        <Canvas />
      </div>
      <RightSidebar />
    </div>
  )
}

export default App
