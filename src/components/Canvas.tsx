import { useRef, useEffect, useCallback, useState } from 'react'
import { Stage, Layer, Rect } from 'react-konva'
import Konva from 'konva'
import { useViewportStore } from '../store/viewportStore'
import { useSceneStore } from '../store/sceneStore'
import { RenderNode } from './nodes/RenderNode'

const ZOOM_FACTOR = 1.1

export function Canvas() {
  const stageRef = useRef<Konva.Stage>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [isSpacePressed, setIsSpacePressed] = useState(false)
  const [isMiddleMouseDown, setIsMiddleMouseDown] = useState(false)
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null)

  const { scale, x, y, isPanning, setPosition, setIsPanning, zoomAtPoint } = useViewportStore()
  const nodes = useSceneStore((state) => state.nodes)

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

  // Keyboard event handlers for spacebar panning
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setIsSpacePressed(true)
        setIsPanning(true)
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
  }, [isMiddleMouseDown, setIsPanning])

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
      }
    },
    [isSpacePressed, setIsPanning]
  )

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
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
        background: '#1a1a1a',
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
            x={0}
            y={0}
            width={2000}
            height={2000}
            fill="#2a2a2a"
          />
          {/* Render scene nodes */}
          {nodes.map((node) => (
            <RenderNode key={node.id} node={node} />
          ))}
        </Layer>
      </Stage>
    </div>
  )
}
