import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { useVariableStore } from '../store/variableStore'
import { useThemeStore } from '../store/themeStore'
import { generateId } from '../types/scene'
import type { SceneNode, FrameNode } from '../types/scene'
import { downloadDocument, openFilePicker } from '../utils/fileUtils'

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

const toolbarBtnClass = 'px-3 py-2 bg-surface-elevated border border-border-light rounded text-text-primary text-[13px] cursor-pointer transition-colors duration-150 hover:bg-surface-hover hover:border-border-hover active:bg-surface-active'

export function Toolbar() {
  const addNode = useSceneStore((state) => state.addNode)
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame)
  const nodes = useSceneStore((state) => state.nodes)
  const setNodes = useSceneStore((state) => state.setNodes)
  const variables = useVariableStore((state) => state.variables)
  const setVariables = useVariableStore((state) => state.setVariables)
  const activeTheme = useThemeStore((state) => state.activeTheme)
  const setActiveTheme = useThemeStore((state) => state.setActiveTheme)
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

  const handleSave = () => {
    downloadDocument(nodes, variables, activeTheme)
  }

  const handleOpen = async () => {
    try {
      const { nodes: loadedNodes, variables: loadedVariables, activeTheme: loadedTheme } = await openFilePicker()
      setNodes(loadedNodes)
      setVariables(loadedVariables)
      setActiveTheme(loadedTheme)
    } catch (err) {
      console.error('Failed to open file:', err)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3 bg-surface-panel border-r border-border-default w-[120px]">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">File</div>
      <button className={toolbarBtnClass} onClick={handleOpen}>
        Open
      </button>
      <button className={toolbarBtnClass} onClick={handleSave}>
        Save
      </button>

      <div className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-1 mt-3">Primitives</div>
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
