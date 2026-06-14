// Builds the Figma node-change list into a parent/child tree keyed by guid.

import { figGuidKey, type FigPasteData } from '../figTypes'
import type { FigTreeNode } from './types'

export function buildFigTree(data: FigPasteData): {
  roots: FigTreeNode[]
  byGuid: Map<string, FigTreeNode>
} {
  const changes = data.message.nodeChanges ?? []
  const byGuid = new Map<string, FigTreeNode>()

  for (const change of changes) {
    if (!change.guid || change.phase === 'REMOVED') continue
    byGuid.set(figGuidKey(change.guid), { change, children: [] })
  }

  const parentless: FigTreeNode[] = []
  for (const node of byGuid.values()) {
    const parentKey = node.change.parentIndex ? figGuidKey(node.change.parentIndex.guid) : ''
    const parent = parentKey ? byGuid.get(parentKey) : undefined
    if (parent) {
      parent.children.push(node)
    } else {
      parentless.push(node)
    }
  }

  const byPosition = (a: FigTreeNode, b: FigTreeNode): number => {
    const pa = a.change.parentIndex?.position ?? ''
    const pb = b.change.parentIndex?.position ?? ''
    return pa < pb ? -1 : pa > pb ? 1 : 0
  }
  for (const node of byGuid.values()) {
    node.children.sort(byPosition)
  }

  // The payload is structured DOCUMENT → CANVAS(es) → copied nodes. Symbol
  // masters referenced by copied instances live on internal-only canvases.
  const roots: FigTreeNode[] = []
  for (const node of byGuid.values()) {
    if (node.change.type !== 'CANVAS' || node.change.internalOnly) continue
    roots.push(...node.children)
  }
  if (roots.length === 0) {
    for (const node of parentless) {
      const type = node.change.type
      if (type === 'DOCUMENT' || type === 'CANVAS') continue
      roots.push(node)
    }
  }
  roots.sort(byPosition)
  return { roots, byGuid }
}
