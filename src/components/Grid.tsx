import { Line, Group } from 'react-konva'
import { useMemo } from 'react'

interface GridProps {
  scale: number
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
}

const SMALL_GRID_SIZE = 10  // 10px in world coordinates
const LARGE_GRID_SIZE = 100 // 100px in world coordinates
const SMALL_GRID_MIN_SCALE = 0.3 // Hide small grid below this zoom level

export function Grid({ scale, x, y, viewportWidth, viewportHeight }: GridProps) {
  const lines = useMemo(() => {
    // Calculate visible world bounds
    const worldMinX = -x / scale
    const worldMaxX = (-x + viewportWidth) / scale
    const worldMinY = -y / scale
    const worldMaxY = (-y + viewportHeight) / scale

    const smallLines: { points: number[]; stroke: string }[] = []
    const largeLines: { points: number[]; stroke: string }[] = []

    // Calculate grid line opacity based on zoom
    const smallGridOpacity = scale >= SMALL_GRID_MIN_SCALE ?
      Math.min(1, (scale - SMALL_GRID_MIN_SCALE) / 0.3) * 0.15 : 0
    const largeGridOpacity = 0.25

    // Small grid lines (only if zoomed in enough)
    if (scale >= SMALL_GRID_MIN_SCALE) {
      const smallStartX = Math.floor(worldMinX / SMALL_GRID_SIZE) * SMALL_GRID_SIZE
      const smallStartY = Math.floor(worldMinY / SMALL_GRID_SIZE) * SMALL_GRID_SIZE

      // Vertical lines
      for (let wx = smallStartX; wx <= worldMaxX; wx += SMALL_GRID_SIZE) {
        // Skip if this is also a large grid line
        if (wx % LARGE_GRID_SIZE === 0) continue
        smallLines.push({
          points: [wx, worldMinY, wx, worldMaxY],
          stroke: `rgba(0, 0, 0, ${smallGridOpacity})`,
        })
      }

      // Horizontal lines
      for (let wy = smallStartY; wy <= worldMaxY; wy += SMALL_GRID_SIZE) {
        // Skip if this is also a large grid line
        if (wy % LARGE_GRID_SIZE === 0) continue
        smallLines.push({
          points: [worldMinX, wy, worldMaxX, wy],
          stroke: `rgba(0, 0, 0, ${smallGridOpacity})`,
        })
      }
    }

    // Large grid lines (always visible)
    const largeStartX = Math.floor(worldMinX / LARGE_GRID_SIZE) * LARGE_GRID_SIZE
    const largeStartY = Math.floor(worldMinY / LARGE_GRID_SIZE) * LARGE_GRID_SIZE

    // Vertical lines
    for (let wx = largeStartX; wx <= worldMaxX; wx += LARGE_GRID_SIZE) {
      largeLines.push({
        points: [wx, worldMinY, wx, worldMaxY],
        stroke: `rgba(0, 0, 0, ${largeGridOpacity})`,
      })
    }

    // Horizontal lines
    for (let wy = largeStartY; wy <= worldMaxY; wy += LARGE_GRID_SIZE) {
      largeLines.push({
        points: [worldMinX, wy, worldMaxX, wy],
        stroke: `rgba(0, 0, 0, ${largeGridOpacity})`,
      })
    }

    return { smallLines, largeLines }
  }, [scale, x, y, viewportWidth, viewportHeight])

  return (
    <Group listening={false}>
      {/* Small grid */}
      {lines.smallLines.map((line, i) => (
        <Line
          key={`small-${i}`}
          points={line.points}
          stroke={line.stroke}
          strokeWidth={1 / scale}
          perfectDrawEnabled={false}
          listening={false}
        />
      ))}
      {/* Large grid */}
      {lines.largeLines.map((line, i) => (
        <Line
          key={`large-${i}`}
          points={line.points}
          stroke={line.stroke}
          strokeWidth={1 / scale}
          perfectDrawEnabled={false}
          listening={false}
        />
      ))}
    </Group>
  )
}
