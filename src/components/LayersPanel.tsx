import { useState, useRef } from 'react'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import type { SceneNode } from '../types/scene'
import './LayersPanel.css'

// Icons for different node types
const NodeIcon = ({ type }: { type: SceneNode['type'] }) => {
  switch (type) {
    case 'frame':
      return (
        <svg viewBox="0 0 16 16" className="layer-icon">
          <rect x="2" y="2" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      )
    case 'rect':
      return (
        <svg viewBox="0 0 16 16" className="layer-icon">
          <rect x="2" y="4" width="12" height="8" fill="currentColor" rx="1" />
        </svg>
      )
    case 'ellipse':
      return (
        <svg viewBox="0 0 16 16" className="layer-icon">
          <ellipse cx="8" cy="8" rx="6" ry="4" fill="currentColor" />
        </svg>
      )
    case 'text':
      return (
        <svg viewBox="0 0 16 16" className="layer-icon">
          <text x="4" y="12" fontSize="10" fill="currentColor" fontWeight="bold">T</text>
        </svg>
      )
    default:
      return null
  }
}

// Eye icon for visibility
const EyeIcon = ({ visible }: { visible: boolean }) => (
  <svg viewBox="0 0 16 16" className="visibility-icon">
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
  onDragStart: (index: number) => void
  onDragOver: (index: number) => void
  onDragEnd: () => void
  isDragging: boolean
  dragOverIndex: number | null
}

function LayerItem({
  node,
  index,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
  dragOverIndex,
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
      className={`layer-item ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${
        dragOverIndex === index ? 'drag-over' : ''
      }`}
      onClick={handleClick}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        onDragStart(index)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        onDragOver(index)
      }}
      onDragEnd={onDragEnd}
    >
      <div className="layer-content">
        <NodeIcon type={node.type} />
        <span className={`layer-name ${!isVisible ? 'hidden-layer' : ''}`}>{displayName}</span>
      </div>
      <button
        className={`visibility-btn ${!isVisible ? 'hidden' : ''}`}
        onClick={handleVisibilityClick}
        title={isVisible ? 'Hide layer' : 'Show layer'}
      >
        <EyeIcon visible={isVisible} />
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

  const handleDragStart = (index: number) => {
    setDragIndex(index)
    dragIndexRef.current = index
  }

  const handleDragOver = (index: number) => {
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (dragIndexRef.current !== null && dragOverIndex !== null && dragIndexRef.current !== dragOverIndex) {
      reorderNode(dragIndexRef.current, dragOverIndex)
    }
    setDragIndex(null)
    setDragOverIndex(null)
    dragIndexRef.current = null
  }

  // Reverse the nodes array so that top items in the list appear on top visually (higher z-index)
  const reversedNodes = [...nodes].reverse()

  return (
    <div className="layers-panel">
      <div className="layers-panel-header">
        <span>Layers</span>
        <span className="layer-count">{nodes.length}</span>
      </div>
      <div className="layers-list">
        {reversedNodes.length === 0 ? (
          <div className="layers-empty">No layers yet</div>
        ) : (
          reversedNodes.map((node, reversedIndex) => {
            // Calculate actual index in original array
            const actualIndex = nodes.length - 1 - reversedIndex
            return (
              <LayerItem
                key={node.id}
                node={node}
                index={actualIndex}
                onDragStart={handleDragStart}
                onDragOver={(idx) => handleDragOver(nodes.length - 1 - idx)}
                onDragEnd={handleDragEnd}
                isDragging={dragIndex === actualIndex}
                dragOverIndex={dragOverIndex !== null ? nodes.length - 1 - dragOverIndex : null}
              />
            )
          })
        )}
      </div>
    </div>
  )
}
