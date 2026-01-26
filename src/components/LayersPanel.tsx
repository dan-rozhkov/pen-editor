import { useState, useCallback, useRef, useEffect } from 'react'
import clsx from 'clsx'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useHoverStore } from '../store/hoverStore'
import type { SceneNode, FrameNode } from '../types/scene'

// Icons for different node types
const NodeIcon = ({ type, isSelected, reusable }: { type: SceneNode['type']; isSelected: boolean; reusable?: boolean }) => {
  const iconClass = clsx('w-4 h-4 shrink-0', isSelected ? 'text-white' : 'text-text-muted')

  switch (type) {
    case 'frame':
      if (reusable) {
        // Component icon: 4 diamonds in a grid pattern (like Figma)
        return (
          <svg viewBox="0 0 16 16" className={iconClass}>
            <path d="M5 2 L8 5 L5 8 L2 5 Z" fill="currentColor" />
            <path d="M11 2 L14 5 L11 8 L8 5 Z" fill="currentColor" />
            <path d="M5 8 L8 11 L5 14 L2 11 Z" fill="currentColor" />
            <path d="M11 8 L14 11 L11 14 L8 11 Z" fill="currentColor" />
          </svg>
        )
      }
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
    case 'ref':
      // Instance icon: single diamond (like Figma instance)
      return (
        <svg viewBox="0 0 16 16" className={iconClass}>
          <path d="M8 2 L14 8 L8 14 L2 8 Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
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

// Chevron icon for expand/collapse
const ChevronIcon = ({ expanded, isSelected }: { expanded: boolean; isSelected: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    className={clsx(
      'w-3 h-3 transition-transform duration-150',
      isSelected ? 'text-white' : 'text-text-muted',
      expanded && 'rotate-90'
    )}
  >
    <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

type DropPosition = 'before' | 'after' | 'inside' | null

interface DragState {
  draggedId: string | null
  dropTargetId: string | null
  dropPosition: DropPosition
  dropParentId: string | null
}

interface LayerItemProps {
  node: SceneNode
  depth: number
  parentId: string | null
  dragState: DragState
  onDragStart: (nodeId: string) => void
  onDragOver: (nodeId: string, position: DropPosition, parentId: string | null) => void
  onDragEnd: () => void
  onDrop: () => void
}

function LayerItem({
  node,
  depth,
  parentId,
  dragState,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: LayerItemProps) {
  const { selectedIds, select, addToSelection } = useSelectionStore()
  const { hoveredNodeId, setHoveredNode } = useHoverStore()
  const toggleVisibility = useSceneStore((state) => state.toggleVisibility)
  const expandedFrameIds = useSceneStore((state) => state.expandedFrameIds)
  const toggleFrameExpanded = useSceneStore((state) => state.toggleFrameExpanded)
  const updateNode = useSceneStore((state) => state.updateNode)

  // Inline editing state
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Auto-focus input when editing starts
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const isSelected = selectedIds.includes(node.id)
  const isVisible = node.visible !== false
  const isFrame = node.type === 'frame'
  const hasChildren = isFrame && (node as FrameNode).children.length > 0
  const isExpanded = expandedFrameIds.has(node.id)
  const isDragging = dragState.draggedId === node.id
  const isDropTarget = dragState.dropTargetId === node.id
  const isHovered = hoveredNodeId === node.id && !isSelected

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

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    toggleFrameExpanded(node.id)
  }

  // Inline editing handlers
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const currentName = node.name || `${node.type.charAt(0).toUpperCase() + node.type.slice(1)}`
    setEditName(currentName)
    setIsEditing(true)
  }

  const handleNameSubmit = () => {
    const trimmed = editName.trim()
    if (trimmed) {
      updateNode(node.id, { name: trimmed })
    }
    setIsEditing(false)
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setIsEditing(false)
    }
  }

  const handleNameBlur = () => {
    handleNameSubmit()
  }

  const handleMouseEnter = () => {
    setHoveredNode(node.id)
  }

  const handleMouseLeave = () => {
    setHoveredNode(null)
  }

  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.id)
    onDragStart(node.id)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const height = rect.height

    let position: DropPosition
    if (isFrame && y > height * 0.25 && y < height * 0.75) {
      // Drop inside frame (middle 50%)
      position = 'inside'
    } else if (y < height / 2) {
      position = 'before'
    } else {
      position = 'after'
    }

    onDragOver(node.id, position, parentId)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onDrop()
  }

  const displayName = node.name || `${node.type.charAt(0).toUpperCase() + node.type.slice(1)}`

  return (
    <>
      <div
        className={clsx(
          'flex items-center justify-between py-1.5 pr-3 cursor-pointer transition-colors duration-100',
          isSelected ? 'bg-accent-primary hover:bg-accent-hover' : 'hover:bg-surface-elevated',
          isDragging && 'opacity-50',
          isDropTarget && dragState.dropPosition === 'before' && 'border-t-2 border-accent-bright',
          isDropTarget && dragState.dropPosition === 'after' && 'border-b-2 border-accent-bright',
          isDropTarget && dragState.dropPosition === 'inside' && 'bg-accent-primary/30'
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        draggable
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={() => {}}
        onDrop={handleDrop}
      >
        <div className="flex items-center gap-1 flex-1 min-w-0">
          {/* Chevron for frames with children */}
          {hasChildren ? (
            <button
              className="bg-transparent border-none cursor-pointer p-0.5 flex items-center justify-center rounded hover:bg-white/10"
              onClick={handleChevronClick}
            >
              <ChevronIcon expanded={isExpanded} isSelected={isSelected} />
            </button>
          ) : (
            <div className="w-4" />
          )}
          <NodeIcon type={node.type} isSelected={isSelected} reusable={node.type === 'frame' && (node as FrameNode).reusable} />
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              onBlur={handleNameBlur}
              onClick={(e) => e.stopPropagation()}
              className={clsx(
                'text-xs bg-transparent border border-accent-bright rounded px-1 py-0.5 outline-none min-w-0 flex-1',
                isSelected ? 'text-white' : 'text-text-secondary'
              )}
            />
          ) : (
            <span
              className={clsx(
                'text-xs whitespace-nowrap overflow-hidden text-ellipsis',
                isSelected ? 'text-white' : 'text-text-secondary',
                !isVisible && 'opacity-50'
              )}
              onDoubleClick={handleDoubleClick}
            >
              {displayName}
            </span>
          )}
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

      {/* Render children if this is an expanded frame */}
      {isFrame && isExpanded && (
        <LayerList
          nodes={[...(node as FrameNode).children].reverse()}
          depth={depth + 1}
          parentId={node.id}
          dragState={dragState}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
        />
      )}
    </>
  )
}

interface LayerListProps {
  nodes: SceneNode[]
  depth: number
  parentId: string | null
  dragState: DragState
  onDragStart: (nodeId: string) => void
  onDragOver: (nodeId: string, position: DropPosition, parentId: string | null) => void
  onDragEnd: () => void
  onDrop: () => void
}

function LayerList({
  nodes,
  depth,
  parentId,
  dragState,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: LayerListProps) {
  return (
    <>
      {nodes.map((node) => (
        <LayerItem
          key={node.id}
          node={node}
          depth={depth}
          parentId={parentId}
          dragState={dragState}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
        />
      ))}
    </>
  )
}

// Helper to count total visible nodes (for the badge)
function countNodes(nodes: SceneNode[]): number {
  return nodes.reduce((count, node) => {
    if (node.type === 'frame') {
      return count + 1 + countNodes((node as FrameNode).children)
    }
    return count + 1
  }, 0)
}

// Helper to get children array of a parent (or root nodes if parentId is null)
function getChildrenOfParent(nodes: SceneNode[], parentId: string | null): SceneNode[] {
  if (parentId === null) {
    return nodes
  }
  for (const node of nodes) {
    if (node.id === parentId && node.type === 'frame') {
      return (node as FrameNode).children
    }
    if (node.type === 'frame') {
      const found = getChildrenOfParent((node as FrameNode).children, parentId)
      if (found.length > 0 || parentId === node.id) {
        return found
      }
    }
  }
  return []
}

export function LayersPanel() {
  const nodes = useSceneStore((state) => state.nodes)
  const moveNode = useSceneStore((state) => state.moveNode)
  const setFrameExpanded = useSceneStore((state) => state.setFrameExpanded)

  const [dragState, setDragState] = useState<DragState>({
    draggedId: null,
    dropTargetId: null,
    dropPosition: null,
    dropParentId: null,
  })

  const handleDragStart = useCallback((nodeId: string) => {
    setDragState({
      draggedId: nodeId,
      dropTargetId: null,
      dropPosition: null,
      dropParentId: null,
    })
  }, [])

  const handleDragOver = useCallback((nodeId: string, position: DropPosition, parentId: string | null) => {
    setDragState((prev) => ({
      ...prev,
      dropTargetId: nodeId,
      dropPosition: position,
      dropParentId: parentId,
    }))
  }, [])

  const handleDragEnd = useCallback(() => {
    setDragState({
      draggedId: null,
      dropTargetId: null,
      dropPosition: null,
      dropParentId: null,
    })
  }, [])

  const handleDrop = useCallback(() => {
    const { draggedId, dropTargetId, dropPosition, dropParentId } = dragState

    if (!draggedId || !dropTargetId || !dropPosition) {
      handleDragEnd()
      return
    }

    // Don't drop on itself
    if (draggedId === dropTargetId) {
      handleDragEnd()
      return
    }

    // Calculate new parent and index
    let newParentId: string | null
    let newIndex: number

    if (dropPosition === 'inside') {
      // Drop inside a frame
      newParentId = dropTargetId
      newIndex = 0 // Insert at the beginning (will appear at top in reversed list)
      // Auto-expand the frame
      setFrameExpanded(dropTargetId, true)
    } else {
      // Drop before or after the target
      newParentId = dropParentId
      const siblings = getChildrenOfParent(nodes, dropParentId)
      const targetIndex = siblings.findIndex((n) => n.id === dropTargetId)

      if (dropPosition === 'before') {
        newIndex = targetIndex
      } else {
        newIndex = targetIndex + 1
      }
    }

    moveNode(draggedId, newParentId, newIndex)
    handleDragEnd()
  }, [dragState, nodes, moveNode, setFrameExpanded, handleDragEnd])

  // Reverse the nodes array so that top items in the list appear on top visually (higher z-index)
  const reversedNodes = [...nodes].reverse()
  const totalCount = countNodes(nodes)

  return (
    <div className="flex-1 bg-surface-panel flex flex-col select-none overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3 border-b border-border-default text-xs font-semibold text-text-primary uppercase tracking-wide">
        <span>Layers</span>
        <span className="bg-border-default text-text-muted px-1.5 py-0.5 rounded text-[10px] font-medium">
          {totalCount}
        </span>
      </div>
      <div
        className="flex-1 overflow-y-auto py-2"
        onDragEnd={handleDragEnd}
      >
        {reversedNodes.length === 0 ? (
          <div className="text-text-disabled text-xs text-center p-5">No layers yet</div>
        ) : (
          <LayerList
            nodes={reversedNodes}
            depth={0}
            parentId={null}
            dragState={dragState}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
          />
        )}
      </div>
    </div>
  )
}
