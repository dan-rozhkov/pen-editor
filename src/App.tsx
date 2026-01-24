import { useEffect } from 'react'
import { Canvas } from './components/Canvas'
import { Toolbar } from './components/Toolbar'
import { RightSidebar } from './components/RightSidebar'
import { useLayoutStore } from './store/layoutStore'

function App() {
  const initializeYoga = useLayoutStore((state) => state.initializeYoga)

  // Initialize yoga-layout WASM module on app mount
  useEffect(() => {
    initializeYoga()
  }, [initializeYoga])

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
