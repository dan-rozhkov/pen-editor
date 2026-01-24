import { Frame, Square, Circle, Type } from 'lucide-react'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { generateId } from '../types/scene'
import type { SceneNode, FrameNode } from '../types/scene'

// Helper to find a node by ID recursively
function findNodeById(nodes: SceneNode[], id: string): SceneNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.type === 'frame') {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

export function PrimitivesPanel() {
  const addNode = useSceneStore((state) => state.addNode)
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame)
  const nodes = useSceneStore((state) => state.nodes)
  const { selectedIds } = useSelectionStore()
  const { scale, x, y } = useViewportStore()

  // Check if a Frame is selected
  const getSelectedFrame = (): FrameNode | null => {
    if (selectedIds.length !== 1) return null
    const node = findNodeById(nodes, selectedIds[0])
    return node?.type === 'frame' ? (node as FrameNode) : null
  }

  const getViewportCenter = () => {
    const centerX = (window.innerWidth / 2 - x) / scale
    const centerY = (window.innerHeight / 2 - y) / scale
    return { centerX, centerY }
  }

  // Add node either to selected frame or to root
  const addNodeOrChild = (node: SceneNode) => {
    const selectedFrame = getSelectedFrame()
    if (selectedFrame) {
      // Add as child to selected frame (position relative to frame)
      const childNode = { ...node, x: 10, y: 10 }
      addChildToFrame(selectedFrame.id, childNode)
    } else {
      addNode(node)
    }
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
    addNodeOrChild(node)
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
    addNodeOrChild(node)
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
    addNodeOrChild(node)
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
      fill: '#333333',
    }
    addNodeOrChild(node)
  }

  const tools = [
    { icon: Frame, label: 'Frame', action: createFrame, shortcut: 'F' },
    { icon: Square, label: 'Rectangle', action: createRect, shortcut: 'R' },
    { icon: Circle, label: 'Ellipse', action: createEllipse, shortcut: 'O' },
    { icon: Type, label: 'Text', action: createText, shortcut: 'T' },
  ]

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 px-2 py-2 bg-surface-panel/95 backdrop-blur-sm border border-border-default rounded-xl shadow-lg">
        {tools.map(({ icon: Icon, label, action, shortcut }) => (
          <button
            key={label}
            onClick={action}
            title={`${label} (${shortcut})`}
            className="group relative p-2.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-elevated transition-colors duration-150"
          >
            <Icon size={20} strokeWidth={1.5} />
            <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-surface-elevated text-text-primary text-xs rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none">
              {label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
