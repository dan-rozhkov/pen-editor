import { Line, Group } from 'react-konva'
import { useMemo } from 'react'
import { useViewportStore } from '@/store/viewportStore'
import { usePixelGridStore } from '@/store/pixelGridStore'
import { useUIThemeStore } from '@/store/uiThemeStore'

const MIN_SCALE = 8    // 800% zoom
const FADE_SCALE = 10  // fully opaque by 1000%
const BASE_OPACITY = 0.03

interface PixelGridProps {
  viewportWidth: number
  viewportHeight: number
}

export function PixelGrid({ viewportWidth, viewportHeight }: PixelGridProps) {
  const scale = useViewportStore((s) => s.scale)
  const vx = useViewportStore((s) => s.x)
  const vy = useViewportStore((s) => s.y)
  const showPixelGrid = usePixelGridStore((s) => s.showPixelGrid)
  const uiTheme = useUIThemeStore((s) => s.uiTheme)

  const lines = useMemo(() => {
    if (!showPixelGrid || scale < MIN_SCALE) return null

    // Fade in between MIN_SCALE and FADE_SCALE
    const t = Math.min(1, (scale - MIN_SCALE) / (FADE_SCALE - MIN_SCALE))
    const opacity = BASE_OPACITY * t

    const color = uiTheme === 'dark'
      ? `rgba(255, 255, 255, ${opacity})`
      : `rgba(0, 0, 0, ${opacity})`

    // Calculate visible world bounds
    const worldMinX = -vx / scale
    const worldMaxX = (-vx + viewportWidth) / scale
    const worldMinY = -vy / scale
    const worldMaxY = (-vy + viewportHeight) / scale

    // Snap to pixel boundaries
    const startX = Math.floor(worldMinX)
    const endX = Math.ceil(worldMaxX)
    const startY = Math.floor(worldMinY)
    const endY = Math.ceil(worldMaxY)

    const result: { points: number[]; stroke: string }[] = []

    // Vertical lines
    for (let wx = startX; wx <= endX; wx++) {
      result.push({
        points: [wx, worldMinY, wx, worldMaxY],
        stroke: color,
      })
    }

    // Horizontal lines
    for (let wy = startY; wy <= endY; wy++) {
      result.push({
        points: [worldMinX, wy, worldMaxX, wy],
        stroke: color,
      })
    }

    return { lines: result, strokeWidth: 1 / scale }
  }, [scale, vx, vy, viewportWidth, viewportHeight, showPixelGrid, uiTheme])

  if (!lines) return null

  return (
    <Group listening={false}>
      {lines.lines.map((line, i) => (
        <Line
          key={i}
          points={line.points}
          stroke={line.stroke}
          strokeWidth={lines.strokeWidth}
          perfectDrawEnabled={false}
          listening={false}
        />
      ))}
    </Group>
  )
}
