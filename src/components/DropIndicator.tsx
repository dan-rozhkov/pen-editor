import { Line } from 'react-konva'
import type { DropIndicatorData } from '../store/dragStore'

interface DropIndicatorProps {
  indicator: DropIndicatorData
}

export function DropIndicator({ indicator }: DropIndicatorProps) {
  const { x, y, length, direction } = indicator

  // Calculate line points based on direction
  const points =
    direction === 'horizontal'
      ? [x, y, x + length, y] // Horizontal line
      : [x, y, x, y + length] // Vertical line

  return (
    <Line
      points={points}
      stroke="#0d99ff"
      strokeWidth={2}
      lineCap="round"
      perfectDrawEnabled={false}
      listening={false}
    />
  )
}
