import { Text } from 'react-konva'
import type Konva from 'konva'
import type { FrameNode } from '../../types/scene'
import { useSelectionStore } from '../../store/selectionStore'

interface FrameNameLabelProps {
  node: FrameNode
  isSelected: boolean
  absoluteX: number
  absoluteY: number
}

const LABEL_FONT_SIZE = 11
const LABEL_OFFSET_Y = 4
const LABEL_COLOR_NORMAL = '#666666'
const LABEL_COLOR_SELECTED = '#0d99ff'
const LABEL_COLOR_COMPONENT = '#9747ff' // Purple for components

export function FrameNameLabel({ node, isSelected, absoluteX, absoluteY }: FrameNameLabelProps) {
  const { startNameEditing, editingNodeId, editingMode } = useSelectionStore()

  // Hide if this frame's name is being edited
  const isEditingThisName = editingNodeId === node.id && editingMode === 'name'
  if (isEditingThisName) {
    return null
  }

  const displayName = node.name || 'Frame'

  // Determine label color: purple for components, blue for selected, gray for normal
  const labelColor = node.reusable
    ? LABEL_COLOR_COMPONENT
    : isSelected
      ? LABEL_COLOR_SELECTED
      : LABEL_COLOR_NORMAL

  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true
    startNameEditing(node.id)
  }

  return (
    <Text
      x={absoluteX}
      y={absoluteY - LABEL_FONT_SIZE - LABEL_OFFSET_Y}
      text={displayName}
      fontSize={LABEL_FONT_SIZE}
      fontFamily="system-ui, -apple-system, sans-serif"
      fill={labelColor}
      listening={true}
      onDblClick={handleDblClick}
    />
  )
}
