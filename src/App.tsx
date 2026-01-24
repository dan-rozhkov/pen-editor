import { useEffect } from 'react'
import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { LeftSidebar } from './components/LeftSidebar'
import { RightSidebar } from './components/RightSidebar'
import { PrimitivesPanel } from './components/PrimitivesPanel'
import { useLayoutStore } from './store/layoutStore'

function App() {
  const initializeYoga = useLayoutStore((state) => state.initializeYoga)

  // Initialize yoga-layout WASM module on app mount
  useEffect(() => {
    initializeYoga()
  }, [initializeYoga])

  return (
    <div className="w-full h-full flex flex-col">
      <Toolbar />
      <div className="flex-1 flex flex-row overflow-hidden">
        <LeftSidebar />
        <div className="flex-1 h-full overflow-hidden relative">
          <Canvas />
          <PrimitivesPanel />
        </div>
        <RightSidebar />
      </div>
    </div>
  )
}

export default App
