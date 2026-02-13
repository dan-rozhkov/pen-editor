import type { FrameNode, GroupNode, SceneNode } from '../types/scene'
import { findNodeById, findParentFrame, getNodeAbsolutePosition } from './nodeUtils'
import { calculateFrameIntrinsicSize } from './yogaLayout'

export type AlignmentType = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom'

interface NodePositionInfo {
  id: string
  node: SceneNode
  absX: number
  absY: number
  effectiveWidth: number
  effectiveHeight: number
  parentOffsetX: number
  parentOffsetY: number
}

/**
 * Calculate new positions for nodes based on alignment type
 * Returns updates to apply via updateNode()
 */
export function alignNodes(
  selectedIds: string[],
  allNodes: SceneNode[],
  alignment: AlignmentType
): { id: string; x?: number; y?: number }[] {
  const nodeInfos = gatherNodeInfos(selectedIds, allNodes)

  if (nodeInfos.length < 2) {
    return [] // Need at least 2 nodes to align
  }

  // Calculate bounding box
  const minX = Math.min(...nodeInfos.map((n) => n.absX))
  const maxX = Math.max(...nodeInfos.map((n) => n.absX + n.effectiveWidth))
  const minY = Math.min(...nodeInfos.map((n) => n.absY))
  const maxY = Math.max(...nodeInfos.map((n) => n.absY + n.effectiveHeight))
  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2

  // Calculate new positions based on alignment type
  const updates: { id: string; x?: number; y?: number }[] = []

  for (const info of nodeInfos) {
    let newAbsX = info.absX
    let newAbsY = info.absY

    switch (alignment) {
      case 'left':
        newAbsX = minX
        break
      case 'centerH':
        newAbsX = centerX - info.effectiveWidth / 2
        break
      case 'right':
        newAbsX = maxX - info.effectiveWidth
        break
      case 'top':
        newAbsY = minY
        break
      case 'centerV':
        newAbsY = centerY - info.effectiveHeight / 2
        break
      case 'bottom':
        newAbsY = maxY - info.effectiveHeight
        break
    }

    // Convert back to relative position (subtract parent offset)
    const newX = newAbsX - info.parentOffsetX
    const newY = newAbsY - info.parentOffsetY

    // Only include changed values
    const update: { id: string; x?: number; y?: number } = { id: info.id }
    if (alignment === 'left' || alignment === 'centerH' || alignment === 'right') {
      update.x = Math.round(newX)
    }
    if (alignment === 'top' || alignment === 'centerV' || alignment === 'bottom') {
      update.y = Math.round(newY)
    }

    updates.push(update)
  }

  return updates
}

/**
 * Gather non-auto-layout selected nodes with absolute positions
 */
function getEffectiveDimensions(node: SceneNode): { width: number; height: number } {
  let effectiveWidth = node.width
  let effectiveHeight = node.height

  if (node.type === 'frame' && (node as FrameNode).layout?.autoLayout) {
    const frame = node as FrameNode
    const fitWidth = frame.sizing?.widthMode === 'fit_content'
    const fitHeight = frame.sizing?.heightMode === 'fit_content'
    if (fitWidth || fitHeight) {
      const intrinsicSize = calculateFrameIntrinsicSize(frame, { fitWidth, fitHeight })
      if (fitWidth) effectiveWidth = intrinsicSize.width
      if (fitHeight) effectiveHeight = intrinsicSize.height
    }
  }

  return { width: effectiveWidth, height: effectiveHeight }
}

function gatherNodeInfos(selectedIds: string[], allNodes: SceneNode[]): NodePositionInfo[] {
  const nodeInfos: NodePositionInfo[] = []

  for (const id of selectedIds) {
    const node = findNodeById(allNodes, id)
    if (!node) continue

    const parentContext = findParentFrame(allNodes, id)
    if (parentContext.isInsideAutoLayout) continue

    const absPos = getNodeAbsolutePosition(allNodes, id)
    if (!absPos) continue

    const parentOffsetX = absPos.x - node.x
    const parentOffsetY = absPos.y - node.y
    const { width, height } = getEffectiveDimensions(node)

    nodeInfos.push({
      id,
      node,
      absX: absPos.x,
      absY: absPos.y,
      effectiveWidth: width,
      effectiveHeight: height,
      parentOffsetX,
      parentOffsetY,
    })
  }

  return nodeInfos
}

/**
 * Determine dominant axis: 'horizontal' if nodes spread wider than tall, else 'vertical'
 */
function getDominantAxis(nodeInfos: NodePositionInfo[]): 'horizontal' | 'vertical' {
  // Use center-point spread to detect arrangement direction.
  // Bounding-box dimensions can be misleading for tall/wide nodes.
  const centerX = nodeInfos.map((n) => n.absX + n.effectiveWidth / 2)
  const centerY = nodeInfos.map((n) => n.absY + n.effectiveHeight / 2)
  const spreadX = Math.max(...centerX) - Math.min(...centerX)
  const spreadY = Math.max(...centerY) - Math.min(...centerY)

  return spreadX >= spreadY ? 'horizontal' : 'vertical'
}

/** Gather node infos, determine dominant axis, and return sorted array (or null if < 2) */
function getSortedNodeInfos(
  selectedIds: string[],
  allNodes: SceneNode[],
): { sorted: NodePositionInfo[]; axis: 'horizontal' | 'vertical' } | null {
  const nodeInfos = gatherNodeInfos(selectedIds, allNodes)
  if (nodeInfos.length < 2) return null

  const axis = getDominantAxis(nodeInfos)
  const sorted = [...nodeInfos].sort((a, b) => {
    if (axis === 'horizontal') return a.absX - b.absX
    return a.absY - b.absY
  })

  return { sorted, axis }
}

/**
 * Calculate the spacing (gap) between selected nodes.
 * Returns a number if all gaps are equal, 'mixed' if they differ, or null if < 2 valid nodes.
 */
export function calculateSpacing(
  selectedIds: string[],
  allNodes: SceneNode[]
): number | 'mixed' | null {
  const result = getSortedNodeInfos(selectedIds, allNodes)
  if (!result) return null
  const { sorted, axis } = result

  // Calculate gaps between consecutive bounding boxes
  const gaps: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (axis === 'horizontal') {
      gaps.push(Math.max(0, Math.round(next.absX - (current.absX + current.effectiveWidth))))
    } else {
      gaps.push(Math.max(0, Math.round(next.absY - (current.absY + current.effectiveHeight))))
    }
  }

  if (gaps.length === 0) return null

  // Check if all gaps are equal (within 1px tolerance)
  const first = gaps[0]
  const allEqual = gaps.every((g) => Math.abs(g - first) <= 1)

  return allEqual ? first : 'mixed'
}

/**
 * Distribute selected nodes with a uniform gap between them.
 * Returns position updates to apply.
 */
export function distributeSpacing(
  selectedIds: string[],
  allNodes: SceneNode[],
  newGap: number
): { id: string; x?: number; y?: number }[] {
  const result = getSortedNodeInfos(selectedIds, allNodes)
  if (!result) return []
  const { sorted, axis } = result

  const gap = Math.max(0, newGap)
  const updates: { id: string; x?: number; y?: number }[] = []

  // First node stays fixed, reposition the rest
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const current = sorted[i]

    let newAbs: number
    if (axis === 'horizontal') {
      newAbs = prev.absX + prev.effectiveWidth + gap
      // Update prev reference for next iteration
      sorted[i] = { ...current, absX: newAbs }
      const newX = Math.round(newAbs - current.parentOffsetX)
      updates.push({ id: current.id, x: newX })
    } else {
      newAbs = prev.absY + prev.effectiveHeight + gap
      sorted[i] = { ...current, absY: newAbs }
      const newY = Math.round(newAbs - current.parentOffsetY)
      updates.push({ id: current.id, y: newY })
    }
  }

  return updates
}

/**
 * Align a single node within its parent frame/group boundaries.
 * Returns position update to apply.
 */
export function alignNodeInFrame(
  allNodes: SceneNode[],
  nodeId: string,
  parentFrame: FrameNode | GroupNode,
  alignment: AlignmentType
): { id: string; x?: number; y?: number } | null {
  const node = findNodeById(allNodes, nodeId)
  if (!node) return null

  const { width: nodeWidth, height: nodeHeight } = getEffectiveDimensions(node)
  const frameWidth = parentFrame.width
  const frameHeight = parentFrame.height

  let newX = node.x
  let newY = node.y

  switch (alignment) {
    case 'left':
      newX = 0
      break
    case 'centerH':
      newX = (frameWidth - nodeWidth) / 2
      break
    case 'right':
      newX = frameWidth - nodeWidth
      break
    case 'top':
      newY = 0
      break
    case 'centerV':
      newY = (frameHeight - nodeHeight) / 2
      break
    case 'bottom':
      newY = frameHeight - nodeHeight
      break
  }

  const update: { id: string; x?: number; y?: number } = { id: nodeId }
  if (alignment === 'left' || alignment === 'centerH' || alignment === 'right') {
    update.x = Math.round(newX)
  }
  if (alignment === 'top' || alignment === 'centerV' || alignment === 'bottom') {
    update.y = Math.round(newY)
  }

  return update
}
