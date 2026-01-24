import { useSceneStore } from '../store/sceneStore'
import { useViewportStore } from '../store/viewportStore'
import { generateId } from '../types/scene'
import type { SceneNode } from '../types/scene'
import './Toolbar.css'

export function Toolbar() {
  const addNode = useSceneStore((state) => state.addNode)
  const { scale, x, y } = useViewportStore()

  const getViewportCenter = () => {
    const centerX = (window.innerWidth / 2 - x) / scale
    const centerY = (window.innerHeight / 2 - y) / scale
    return { centerX, centerY }
  }

  const createFrame = () => {
    const { centerX, centerY } = getViewportCenter()
    const node: SceneNode = {
      id: generateId(),
      type: 'frame',
      x: centerX - 100,
      y: centerY - 75,
      width: 200,
      height: 150,
      fill: '#ffffff',
      stroke: '#cccccc',
      strokeWidth: 1,
      children: [],
    }
    addNode(node)
  }

  const createRect = () => {
    const { centerX, centerY } = getViewportCenter()
    const node: SceneNode = {
      id: generateId(),
      type: 'rect',
      x: centerX - 75,
      y: centerY - 50,
      width: 150,
      height: 100,
      fill: '#4a90d9',
      cornerRadius: 4,
    }
    addNode(node)
  }

  const createEllipse = () => {
    const { centerX, centerY } = getViewportCenter()
    const node: SceneNode = {
      id: generateId(),
      type: 'ellipse',
      x: centerX - 60,
      y: centerY - 60,
      width: 120,
      height: 120,
      fill: '#d94a4a',
    }
    addNode(node)
  }

  const createText = () => {
    const { centerX, centerY } = getViewportCenter()
    const node: SceneNode = {
      id: generateId(),
      type: 'text',
      x: centerX - 50,
      y: centerY - 10,
      width: 100,
      height: 24,
      text: 'Text',
      fontSize: 18,
      fontFamily: 'Arial',
      fill: '#ffffff',
    }
    addNode(node)
  }

  return (
    <div className="toolbar">
      <div className="toolbar-title">Primitives</div>
      <button className="toolbar-btn" onClick={createFrame}>
        Frame
      </button>
      <button className="toolbar-btn" onClick={createRect}>
        Rectangle
      </button>
      <button className="toolbar-btn" onClick={createEllipse}>
        Ellipse
      </button>
      <button className="toolbar-btn" onClick={createText}>
        Text
      </button>
    </div>
  )
}
