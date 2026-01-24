import { useRef, useCallback, useEffect, useState } from 'react'
import type { SceneNode } from '../types/scene'
import { calculateNodesBounds } from '../utils/viewportUtils'

interface ScrollbarsProps {
  scale: number
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
  nodes: SceneNode[]
  onScroll: (x: number, y: number) => void
}

const SCROLLBAR_SIZE = 12
const THUMB_MIN_SIZE = 30
const SCROLLBAR_PADDING = 4

export function Scrollbars({
  scale,
  x,
  y,
  viewportWidth,
  viewportHeight,
  nodes,
  onScroll,
}: ScrollbarsProps) {
  const [isDraggingH, setIsDraggingH] = useState(false)
  const [isDraggingV, setIsDraggingV] = useState(false)
  const dragStartRef = useRef<{ pos: number; scroll: number } | null>(null)

  // Calculate content bounds with some padding
  const contentBounds = calculateNodesBounds(nodes)

  // Add padding around content and include origin
  const padding = 500
  const worldMinX = contentBounds.isEmpty ? -padding : Math.min(0, contentBounds.minX) - padding
  const worldMaxX = contentBounds.isEmpty ? padding : Math.max(0, contentBounds.maxX) + padding
  const worldMinY = contentBounds.isEmpty ? -padding : Math.min(0, contentBounds.minY) - padding
  const worldMaxY = contentBounds.isEmpty ? padding : Math.max(0, contentBounds.maxY) + padding

  // Total content size in screen pixels
  const totalWidth = (worldMaxX - worldMinX) * scale
  const totalHeight = (worldMaxY - worldMinY) * scale

  // Current viewport position in content
  const viewportLeft = -x - worldMinX * scale
  const viewportTop = -y - worldMinY * scale

  // Scrollbar track dimensions (minus corner)
  const trackWidth = viewportWidth - SCROLLBAR_SIZE - SCROLLBAR_PADDING * 2
  const trackHeight = viewportHeight - SCROLLBAR_SIZE - SCROLLBAR_PADDING * 2

  // Thumb sizes (proportional to viewport/content ratio)
  const thumbWidthRatio = Math.min(1, viewportWidth / totalWidth)
  const thumbHeightRatio = Math.min(1, viewportHeight / totalHeight)
  const thumbWidth = Math.max(THUMB_MIN_SIZE, trackWidth * thumbWidthRatio)
  const thumbHeight = Math.max(THUMB_MIN_SIZE, trackHeight * thumbHeightRatio)

  // Thumb positions
  const scrollRangeX = totalWidth - viewportWidth
  const scrollRangeY = totalHeight - viewportHeight
  const thumbMaxX = trackWidth - thumbWidth
  const thumbMaxY = trackHeight - thumbHeight

  const thumbX = scrollRangeX > 0 ? (viewportLeft / scrollRangeX) * thumbMaxX : 0
  const thumbY = scrollRangeY > 0 ? (viewportTop / scrollRangeY) * thumbMaxY : 0

  // Clamp thumb positions
  const clampedThumbX = Math.max(0, Math.min(thumbMaxX, thumbX))
  const clampedThumbY = Math.max(0, Math.min(thumbMaxY, thumbY))

  // Handle horizontal scrollbar drag
  const handleHorizontalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingH(true)
    dragStartRef.current = { pos: e.clientX, scroll: x }
  }, [x])

  // Handle vertical scrollbar drag
  const handleVerticalMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingV(true)
    dragStartRef.current = { pos: e.clientY, scroll: y }
  }, [y])

  // Global mouse move/up handlers
  useEffect(() => {
    if (!isDraggingH && !isDraggingV) return

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return

      if (isDraggingH) {
        const delta = e.clientX - dragStartRef.current.pos
        const scrollDelta = (delta / thumbMaxX) * scrollRangeX
        const newX = dragStartRef.current.scroll - scrollDelta
        onScroll(newX, y)
      }

      if (isDraggingV) {
        const delta = e.clientY - dragStartRef.current.pos
        const scrollDelta = (delta / thumbMaxY) * scrollRangeY
        const newY = dragStartRef.current.scroll - scrollDelta
        onScroll(x, newY)
      }
    }

    const handleMouseUp = () => {
      setIsDraggingH(false)
      setIsDraggingV(false)
      dragStartRef.current = null
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDraggingH, isDraggingV, x, y, thumbMaxX, thumbMaxY, scrollRangeX, scrollRangeY, onScroll])

  // Don't show scrollbars if content fits in viewport
  const showHorizontal = totalWidth > viewportWidth
  const showVertical = totalHeight > viewportHeight

  if (!showHorizontal && !showVertical) return null

  return (
    <>
      {/* Horizontal scrollbar */}
      {showHorizontal && (
        <div
          style={{
            position: 'absolute',
            bottom: SCROLLBAR_PADDING,
            left: SCROLLBAR_PADDING,
            width: trackWidth,
            height: SCROLLBAR_SIZE,
            background: 'rgba(0, 0, 0, 0.05)',
            borderRadius: SCROLLBAR_SIZE / 2,
            zIndex: 20,
          }}
        >
          <div
            onMouseDown={handleHorizontalMouseDown}
            style={{
              position: 'absolute',
              left: clampedThumbX,
              top: 2,
              width: thumbWidth,
              height: SCROLLBAR_SIZE - 4,
              background: isDraggingH ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)',
              borderRadius: (SCROLLBAR_SIZE - 4) / 2,
              cursor: 'pointer',
              transition: isDraggingH ? 'none' : 'background 0.15s',
            }}
          />
        </div>
      )}

      {/* Vertical scrollbar */}
      {showVertical && (
        <div
          style={{
            position: 'absolute',
            right: SCROLLBAR_PADDING,
            top: SCROLLBAR_PADDING,
            width: SCROLLBAR_SIZE,
            height: trackHeight,
            background: 'rgba(0, 0, 0, 0.05)',
            borderRadius: SCROLLBAR_SIZE / 2,
            zIndex: 20,
          }}
        >
          <div
            onMouseDown={handleVerticalMouseDown}
            style={{
              position: 'absolute',
              top: clampedThumbY,
              left: 2,
              width: SCROLLBAR_SIZE - 4,
              height: thumbHeight,
              background: isDraggingV ? 'rgba(0, 0, 0, 0.5)' : 'rgba(0, 0, 0, 0.3)',
              borderRadius: (SCROLLBAR_SIZE - 4) / 2,
              cursor: 'pointer',
              transition: isDraggingV ? 'none' : 'background 0.15s',
            }}
          />
        </div>
      )}
    </>
  )
}
