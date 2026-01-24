import { Rect, Ellipse, Text, Group } from 'react-konva'
import type { SceneNode, FrameNode } from '../../types/scene'

interface RenderNodeProps {
  node: SceneNode
}

export function RenderNode({ node }: RenderNodeProps) {
  switch (node.type) {
    case 'frame':
      return <FrameRenderer node={node} />
    case 'rect':
      return (
        <Rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          fill={node.fill}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
          cornerRadius={node.cornerRadius}
        />
      )
    case 'ellipse':
      return (
        <Ellipse
          x={node.x + node.width / 2}
          y={node.y + node.height / 2}
          radiusX={node.width / 2}
          radiusY={node.height / 2}
          fill={node.fill}
          stroke={node.stroke}
          strokeWidth={node.strokeWidth}
        />
      )
    case 'text':
      return (
        <Text
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          text={node.text}
          fontSize={node.fontSize ?? 16}
          fontFamily={node.fontFamily ?? 'Arial'}
          fill={node.fill ?? '#000000'}
        />
      )
    default:
      return null
  }
}

function FrameRenderer({ node }: { node: FrameNode }) {
  return (
    <Group x={node.x} y={node.y}>
      <Rect
        width={node.width}
        height={node.height}
        fill={node.fill}
        stroke={node.stroke}
        strokeWidth={node.strokeWidth}
        cornerRadius={node.cornerRadius}
      />
      {node.children.map((child) => (
        <RenderNode key={child.id} node={child} />
      ))}
    </Group>
  )
}
