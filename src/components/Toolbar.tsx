import { useSceneStore } from '../store/sceneStore'
import { useViewportStore } from '../store/viewportStore'
import { generateId } from '../types/scene'
import type { SceneNode } from '../types/scene'

const toolbarBtnClass = 'px-3 py-2 bg-surface-elevated border border-border-light rounded text-white text-[13px] cursor-pointer transition-colors duration-150 hover:bg-surface-hover hover:border-border-hover active:bg-surface-active'

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
    <div className="flex flex-col gap-2 p-3 bg-surface-panel border-r border-border-default w-[120px]">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Primitives</div>
      <button className={toolbarBtnClass} onClick={createFrame}>
        Frame
      </button>
      <button className={toolbarBtnClass} onClick={createRect}>
        Rectangle
      </button>
      <button className={toolbarBtnClass} onClick={createEllipse}>
        Ellipse
      </button>
      <button className={toolbarBtnClass} onClick={createText}>
        Text
      </button>
    </div>
  )
}
