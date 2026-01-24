import { useRef, useEffect, useCallback, useState } from 'react'
import { Stage, Layer, Rect, Transformer } from 'react-konva'
import Konva from 'konva'
import { useViewportStore } from '../store/viewportStore'
import { useSceneStore } from '../store/sceneStore'
import { useSelectionStore } from '../store/selectionStore'
import { useHistoryStore } from '../store/historyStore'
import { RenderNode } from './nodes/RenderNode'

const ZOOM_FACTOR = 1.1

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isMiddleMouseDown, setIsMiddleMouseDown] = useState(false)
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null)

  const { scale, x, y, isPanning, setPosition, setIsPanning, zoomAtPoint } = useViewportStore()
  const nodes = useSceneStore((state) => state.nodes)
  const deleteNode = useSceneStore((state) => state.deleteNode)
  const setNodesWithoutHistory = useSceneStore((state) => state.setNodesWithoutHistory)
  const { selectedIds, clearSelection } = useSelectionStore()
  const { undo, redo, saveHistory, startBatch, endBatch } = useHistoryStore()

  // Update transformer nodes when selection changes
  useEffect(() => {
    const transformer = transformerRef.current
    const stage = stageRef.current
    if (!transformer || !stage) return

    // Find selected nodes on stage
    const selectedNodes: Konva.Node[] = []
    selectedIds.forEach((id) => {
      const node = stage.findOne(`#${id}`)
      if (node) {
        selectedNodes.push(node)
      }
    })

    transformer.nodes(selectedNodes)
    transformer.getLayer()?.batchDraw()
  }, [selectedIds])

  // Resize handler
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Keyboard event handlers for spacebar panning, deletion, undo/redo, and escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't handle if user is typing in an input field
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      // Undo: Cmd+Z (Mac) or Ctrl+Z (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && !e.shiftKey) {
        e.preventDefault()
        const currentNodes = useSceneStore.getState().nodes
        const prevState = undo(currentNodes)
        if (prevState) {
          setNodesWithoutHistory(prevState)
        }
        return
      }

      // Redo: Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (Win/Linux)
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyZ' && e.shiftKey) {
        e.preventDefault()
        const currentNodes = useSceneStore.getState().nodes
        const nextState = redo(currentNodes)
        if (nextState) {
          setNodesWithoutHistory(nextState)
        }
        return
      }

      // Spacebar panning
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setIsSpacePressed(true)
        setIsPanning(true)
      }

      // Delete/Backspace - delete selected elements
      if (e.code === 'Delete' || e.code === 'Backspace') {
        if (isTyping) return
        e.preventDefault()
        const ids = useSelectionStore.getState().selectedIds
        if (ids.length > 0) {
          // Save history once before batch delete
          const currentNodes = useSceneStore.getState().nodes
          saveHistory(currentNodes)
          startBatch()
          ids.forEach((id) => deleteNode(id))
          endBatch()
          clearSelection()
        }
      }

      // Escape - clear selection
      if (e.code === 'Escape') {
        clearSelection()
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false)
        if (!isMiddleMouseDown) {
          setIsPanning(false)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [isMiddleMouseDown, setIsPanning, deleteNode, clearSelection, undo, redo, setNodesWithoutHistory, saveHistory, startBatch, endBatch])

  // Mouse wheel zoom
  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault()

      const stage = stageRef.current
      if (!stage) return

      const pointerPos = stage.getPointerPosition()
      if (!pointerPos) return

      const direction = e.evt.deltaY > 0 ? -1 : 1
      const newScale = direction > 0 ? scale * ZOOM_FACTOR : scale / ZOOM_FACTOR

      zoomAtPoint(newScale, pointerPos.x, pointerPos.y)
    },
    [scale, zoomAtPoint]
  )

  // Pan handlers
  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      // Middle mouse button (button 1)
      if (e.evt.button === 1) {
        e.evt.preventDefault()
        setIsMiddleMouseDown(true)
        setIsPanning(true)
        const stage = stageRef.current
        if (stage) {
          lastPointerPosition.current = stage.getPointerPosition()
        }
      } else if (isSpacePressed && e.evt.button === 0) {
        // Left click while space is pressed
        const stage = stageRef.current
        if (stage) {
          lastPointerPosition.current = stage.getPointerPosition()
        }
      } else if (e.evt.button === 0) {
        // Left click on empty space - clear selection
        const clickedOnEmpty = e.target === e.target.getStage() || e.target.name() === 'background'
        if (clickedOnEmpty) {
          clearSelection()
        }
      }
    },
    [isSpacePressed, setIsPanning, clearSelection]
  )

  const handleMouseMove = useCallback(
    () => {
      if (!isPanning || !lastPointerPosition.current) return

      const stage = stageRef.current
      if (!stage) return

      const pointerPos = stage.getPointerPosition()
      if (!pointerPos) return

      const dx = pointerPos.x - lastPointerPosition.current.x
      const dy = pointerPos.y - lastPointerPosition.current.y

      setPosition(x + dx, y + dy)
      lastPointerPosition.current = pointerPos
    },
    [isPanning, x, y, setPosition]
  )

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1) {
        setIsMiddleMouseDown(false)
        if (!isSpacePressed) {
          setIsPanning(false)
        }
      }
      lastPointerPosition.current = null
    },
    [isSpacePressed, setIsPanning]
  )

  // Prevent context menu on middle click
  const handleContextMenu = useCallback((e: Konva.KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
  }, [])

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        cursor: isPanning ? 'grab' : 'default',
        background: '#f5f5f5',
      }}
    >
      <Stage
        ref={stageRef}
        width={dimensions.width}
        height={dimensions.height}
        scaleX={scale}
        scaleY={scale}
        x={x}
        y={y}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onContextMenu={handleContextMenu}
      >
        <Layer>
          {/* Grid background indicator */}
          <Rect
            name="background"
            x={0}
            y={0}
            width={2000}
            height={2000}
            fill="#e8e8e8"
          />
          {/* Render scene nodes */}
          {nodes.map((node) => (
            <RenderNode key={node.id} node={node} />
          ))}
          {/* Transformer for selection */}
          <Transformer
            ref={transformerRef}
            boundBoxFunc={(oldBox, newBox) => {
              // Limit minimum size
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox
              }
              return newBox
            }}
            anchorSize={8}
            anchorCornerRadius={2}
            borderStroke="#0d99ff"
            anchorStroke="#0d99ff"
            anchorFill="#ffffff"
          />
        </Layer>
      </Stage>
    </div>
  )
}
