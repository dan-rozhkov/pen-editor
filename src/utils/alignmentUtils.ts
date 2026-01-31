import type { SceneNode } from '../types/scene'
import { findNodeById, findParentFrame, getNodeAbsolutePosition } from './nodeUtils'

export type AlignmentType = 'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom'

interface NodePositionInfo {
  id: string
  node: SceneNode
  absX: number
  absY: number
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
  // Gather position info for each selected node
  const nodeInfos: NodePositionInfo[] = []

  for (const id of selectedIds) {
    const node = findNodeById(allNodes, id)
    if (!node) continue

    // Skip nodes inside auto-layout (their position is controlled by Yoga)
    const parentContext = findParentFrame(allNodes, id)
    if (parentContext.isInsideAutoLayout) continue

    const absPos = getNodeAbsolutePosition(allNodes, id)
    if (!absPos) continue

    // Calculate parent offset (absolute position of parent frame)
    const parentOffsetX = absPos.x - node.x
    const parentOffsetY = absPos.y - node.y

    nodeInfos.push({
      id,
      node,
      absX: absPos.x,
      absY: absPos.y,
      parentOffsetX,
      parentOffsetY,
    })
  }

  if (nodeInfos.length < 2) {
    return [] // Need at least 2 nodes to align
  }

  // Calculate bounding box
  const minX = Math.min(...nodeInfos.map((n) => n.absX))
  const maxX = Math.max(...nodeInfos.map((n) => n.absX + n.node.width))
  const minY = Math.min(...nodeInfos.map((n) => n.absY))
  const maxY = Math.max(...nodeInfos.map((n) => n.absY + n.node.height))
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
        newAbsX = centerX - info.node.width / 2
        break
      case 'right':
        newAbsX = maxX - info.node.width
        break
      case 'top':
        newAbsY = minY
        break
      case 'centerV':
        newAbsY = centerY - info.node.height / 2
        break
      case 'bottom':
        newAbsY = maxY - info.node.height
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

    nodeInfos.push({
      id,
      node,
      absX: absPos.x,
      absY: absPos.y,
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
  const minX = Math.min(...nodeInfos.map((n) => n.absX))
  const maxX = Math.max(...nodeInfos.map((n) => n.absX + n.node.width))
  const minY = Math.min(...nodeInfos.map((n) => n.absY))
  const maxY = Math.max(...nodeInfos.map((n) => n.absY + n.node.height))

  return (maxX - minX) >= (maxY - minY) ? 'horizontal' : 'vertical'
}

/**
 * Calculate the spacing (gap) between selected nodes.
 * Returns a number if all gaps are equal, 'mixed' if they differ, or null if < 2 valid nodes.
 */
export function calculateSpacing(
  selectedIds: string[],
  allNodes: SceneNode[]
): number | 'mixed' | null {
  const nodeInfos = gatherNodeInfos(selectedIds, allNodes)
  if (nodeInfos.length < 2) return null

  const axis = getDominantAxis(nodeInfos)

  // Sort by position on dominant axis
  const sorted = [...nodeInfos].sort((a, b) => {
    if (axis === 'horizontal') return a.absX - b.absX
    return a.absY - b.absY
  })

  // Calculate gaps between consecutive bounding boxes
  const gaps: number[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const current = sorted[i]
    const next = sorted[i + 1]
    if (axis === 'horizontal') {
      gaps.push(Math.round(next.absX - (current.absX + current.node.width)))
    } else {
      gaps.push(Math.round(next.absY - (current.absY + current.node.height)))
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
  const nodeInfos = gatherNodeInfos(selectedIds, allNodes)
  if (nodeInfos.length < 2) return []

  const axis = getDominantAxis(nodeInfos)

  // Sort by position on dominant axis
  const sorted = [...nodeInfos].sort((a, b) => {
    if (axis === 'horizontal') return a.absX - b.absX
    return a.absY - b.absY
  })

  const updates: { id: string; x?: number; y?: number }[] = []

  // First node stays fixed, reposition the rest
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const current = sorted[i]

    let newAbs: number
    if (axis === 'horizontal') {
      newAbs = prev.absX + prev.node.width + newGap
      // Update prev reference for next iteration
      sorted[i] = { ...current, absX: newAbs }
      const newX = Math.round(newAbs - current.parentOffsetX)
      updates.push({ id: current.id, x: newX })
    } else {
      newAbs = prev.absY + prev.node.height + newGap
      sorted[i] = { ...current, absY: newAbs }
      const newY = Math.round(newAbs - current.parentOffsetY)
      updates.push({ id: current.id, y: newY })
    }
  }

  return updates
}
