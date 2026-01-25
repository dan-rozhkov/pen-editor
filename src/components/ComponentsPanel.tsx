import clsx from 'clsx'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useViewportStore } from '../store/viewportStore'
import { getAllComponents, findNodeById } from '../utils/nodeUtils'
import { generateId } from '../types/scene'
import type { SceneNode, FrameNode, RefNode } from '../types/scene'

export function ComponentsPanel() {
  const nodes = useSceneStore((state) => state.nodes)
  const addNode = useSceneStore((state) => state.addNode)
  const addChildToFrame = useSceneStore((state) => state.addChildToFrame)
  const { selectedIds } = useSelectionStore()
  const { scale, x, y } = useViewportStore()

  // Get all components from the scene
  const components = getAllComponents(nodes)

  // Check if a Frame is selected (to add instance as child)
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

  const createInstance = (component: FrameNode) => {
    const { centerX, centerY } = getViewportCenter()

    const instance: RefNode = {
      id: generateId(),
      type: 'ref',
      componentId: component.id,
      name: `${component.name || 'Component'} instance`,
      x: centerX - component.width / 2,
      y: centerY - component.height / 2,
      width: component.width,
      height: component.height,
      visible: true,
    }

    const selectedFrame = getSelectedFrame()
    if (selectedFrame && selectedFrame.id !== component.id) {
      // Add as child to selected frame (position relative to frame)
      const childInstance = { ...instance, x: 10, y: 10 }
      addChildToFrame(selectedFrame.id, childInstance as SceneNode)
    } else {
      addNode(instance as SceneNode)
    }
  }

  if (components.length === 0) {
    return (
      <div className="bg-surface-panel flex flex-col select-none border-b border-border-default">
        <div className="flex justify-between items-center px-4 py-3 border-b border-border-default text-xs font-semibold text-text-primary uppercase tracking-wide">
          <span>Components</span>
          <span className="bg-border-default text-text-muted px-1.5 py-0.5 rounded text-[10px] font-medium">
            0
          </span>
        </div>
        <div className="text-text-disabled text-xs text-center p-5">
          No components yet
        </div>
      </div>
    )
  }

  return (
    <div className="bg-surface-panel flex flex-col select-none border-b border-border-default max-h-[200px]">
      <div className="flex justify-between items-center px-4 py-3 border-b border-border-default text-xs font-semibold text-text-primary uppercase tracking-wide">
        <span>Components</span>
        <span className="bg-border-default text-text-muted px-1.5 py-0.5 rounded text-[10px] font-medium">
          {components.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {components.map((component) => (
          <button
            key={component.id}
            onClick={() => createInstance(component)}
            className={clsx(
              'w-full flex items-center gap-2 px-4 py-2 text-left',
              'hover:bg-surface-elevated transition-colors duration-100'
            )}
          >
            {/* Component icon: 4 diamonds */}
            <svg viewBox="0 0 16 16" className="w-4 h-4 shrink-0 text-purple-400">
              <path d="M5 2 L8 5 L5 8 L2 5 Z" fill="currentColor" />
              <path d="M11 2 L14 5 L11 8 L8 5 Z" fill="currentColor" />
              <path d="M5 8 L8 11 L5 14 L2 11 Z" fill="currentColor" />
              <path d="M11 8 L14 11 L11 14 L8 11 Z" fill="currentColor" />
            </svg>
            <span className="text-xs text-text-secondary truncate">
              {component.name || 'Component'}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
