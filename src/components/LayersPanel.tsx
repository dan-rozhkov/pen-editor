import { useState, useRef } from 'react'
import clsx from 'clsx'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import type { SceneNode } from '../types/scene'

// Icons for different node types
const NodeIcon = ({ type, isSelected }: { type: SceneNode['type']; isSelected: boolean }) => {
  const iconClass = clsx('w-4 h-4 shrink-0', isSelected ? 'text-white' : 'text-text-muted')

  switch (type) {
    case 'frame':
      return (
        <svg viewBox="0 0 16 16" className={iconClass}>
          <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'rect':
      return (
        <svg viewBox="0 0 16 16" className={iconClass}>
          <rect x="2" y="4" width="12" height="8" fill="currentColor" rx="1" />
        </svg>
      )
    case 'ellipse':
      return (
        <svg viewBox="0 0 16 16" className={iconClass}>
          <ellipse cx="8" cy="8" rx="6" ry="4" fill="currentColor" />
        </svg>
      )
    case 'text':
      return (
        <svg viewBox="0 0 16 16" className={iconClass}>
          <text x="4" y="12" fontSize="10" fill="currentColor" fontWeight="bold">T</text>
        </svg>
      )
    default:
      return null
  }
}

// Eye icon for visibility
const EyeIcon = ({ visible, isSelected }: { visible: boolean; isSelected: boolean }) => (
  <svg viewBox="0 0 16 16" className={clsx('w-4 h-4', isSelected ? 'text-white' : 'text-text-muted')}>
    {visible ? (
      <>
        <ellipse cx="8" cy="8" rx="6" ry="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      </>
    ) : (
      <>
        <ellipse cx="8" cy="8" rx="6" ry="3.5" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.4" />
        <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.4" />
        <line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" strokeWidth="1.5" />
      </>
    )}
  </svg>
)

interface LayerItemProps {
  node: SceneNode
  index: number
  onDragStart: () => void
  onDragOver: () => void
  onDragEnd: () => void
  isDragging: boolean
  isDragOver: boolean
}

function LayerItem({
  node,
  index,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
  isDragOver,
}: LayerItemProps) {
  const { selectedIds, select, addToSelection } = useSelectionStore()
  const toggleVisibility = useSceneStore((state) => state.toggleVisibility)
  const isSelected = selectedIds.includes(node.id)
  const isVisible = node.visible !== false

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      addToSelection(node.id)
    } else {
      select(node.id)
    }
  }

  const handleVisibilityClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleVisibility(node.id)
  }

  const displayName = node.name || `${node.type.charAt(0).toUpperCase() + node.type.slice(1)} ${index + 1}`

  return (
    <div
      className={clsx(
        'flex items-center justify-between px-3 py-2 cursor-pointer transition-colors duration-100',
        isSelected ? 'bg-accent-primary hover:bg-accent-hover' : 'hover:bg-surface-elevated',
        isDragging && 'opacity-50',
        isDragOver && 'border-t-2 border-accent-bright'
      )}
      onClick={handleClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver()
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <NodeIcon type={node.type} isSelected={isSelected} />
        <span
          className={clsx(
            'text-xs whitespace-nowrap overflow-hidden text-ellipsis',
            isSelected ? 'text-white' : 'text-text-secondary',
            !isVisible && 'opacity-50'
          )}
        >
          {displayName}
        </span>
      </div>
      <button
        className={clsx(
          'bg-transparent border-none cursor-pointer p-1 flex items-center justify-center rounded transition-opacity duration-100',
          isVisible ? 'opacity-60 hover:opacity-100 hover:bg-white/10' : 'opacity-30'
        )}
        onClick={handleVisibilityClick}
        title={isVisible ? 'Hide layer' : 'Show layer'}
      >
        <EyeIcon visible={isVisible} isSelected={isSelected} />
      </button>
    </div>
  )
}

export function LayersPanel() {
  const nodes = useSceneStore((state) => state.nodes)
  const reorderNode = useSceneStore((state) => state.reorderNode)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragIndexRef = useRef<number | null>(null)

  // We work with "visual indices" (0 = top layer in UI = last in nodes array)
  const handleDragStart = (visualIndex: number) => {
    setDragIndex(visualIndex)
    dragIndexRef.current = visualIndex
  }

  const handleDragOver = (visualIndex: number) => {
    setDragOverIndex(visualIndex)
  }

  const handleDragEnd = () => {
    if (dragIndexRef.current !== null && dragOverIndex !== null && dragIndexRef.current !== dragOverIndex) {
      // Convert visual indices to actual array indices
      const fromActual = nodes.length - 1 - dragIndexRef.current
      const toActual = nodes.length - 1 - dragOverIndex
      reorderNode(fromActual, toActual)
    }
    setDragIndex(null)
    setDragOverIndex(null)
    dragIndexRef.current = null
  }

  // Reverse the nodes array so that top items in the list appear on top visually (higher z-index)
  const reversedNodes = [...nodes].reverse()

  return (
    <div className="h-[280px] shrink-0 bg-surface-panel border-b border-border-default flex flex-col select-none">
      <div className="flex justify-between items-center px-4 py-3 border-b border-border-default text-xs font-semibold text-white uppercase tracking-wide">
        <span>Layers</span>
        <span className="bg-border-default text-text-muted px-1.5 py-0.5 rounded text-[10px] font-medium">
          {nodes.length}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {reversedNodes.length === 0 ? (
          <div className="text-text-disabled text-xs text-center p-5">No layers yet</div>
        ) : (
          reversedNodes.map((node, visualIndex) => {
            // actualIndex is for selection and display name
            const actualIndex = nodes.length - 1 - visualIndex
            return (
              <LayerItem
                key={node.id}
                node={node}
                index={actualIndex}
                onDragStart={() => handleDragStart(visualIndex)}
                onDragOver={() => handleDragOver(visualIndex)}
                onDragEnd={handleDragEnd}
                isDragging={dragIndex === visualIndex}
                isDragOver={dragOverIndex === visualIndex}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
