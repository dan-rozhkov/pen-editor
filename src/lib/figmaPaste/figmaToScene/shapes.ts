// Conversion of leaf shape nodes: rectangles, ellipses, lines and vectors.

import type { EllipseNode, LineNode, PathNode, RectNode } from '@/types/scene'
import type { FigNodeChange } from '../figTypes'
import { decodePathCommandsBlob, decodeVectorNetworkBlob, vectorNetworkToPathData } from '../pathBlobs'
import { buildBase, perCornerRadius, resolveStroke } from './base'
import type { ConvertContext } from './types'

export function convertRect(change: FigNodeChange, ctx: ConvertContext): RectNode {
  const node: RectNode = { type: 'rect', ...buildBase(change, ctx) }
  if (change.cornerRadius) node.cornerRadius = change.cornerRadius
  const corners = perCornerRadius(change)
  if (corners) node.cornerRadiusPerCorner = corners
  return node
}

export function convertEllipse(change: FigNodeChange, ctx: ConvertContext): EllipseNode {
  return { type: 'ellipse', ...buildBase(change, ctx) }
}

function geometryFromPaths(
  paths: { commandsBlob?: number; windingRule?: 'NONZERO' | 'ODD' }[] | undefined,
  ctx: ConvertContext,
): { d: string; windingRule: 'NONZERO' | 'ODD' } | null {
  if (!paths || paths.length === 0) return null
  const parts: string[] = []
  for (const path of paths) {
    if (path.commandsBlob == null) continue
    const blob = ctx.blobs[path.commandsBlob]
    if (!blob) continue
    const d = decodePathCommandsBlob(blob.bytes)
    if (d) parts.push(d)
  }
  if (parts.length === 0) return null
  return { d: parts.join(' '), windingRule: paths[0].windingRule ?? 'NONZERO' }
}

/**
 * Vector geometry from the editing topology (vectorNetworkBlob) — clipboard
 * payloads carry this instead of derived fill/stroke command geometry.
 */
function geometryFromVectorNetwork(
  change: FigNodeChange,
  ctx: ConvertContext,
): { d: string; windingRule: 'NONZERO' | 'ODD' } | null {
  const blobIndex = change.vectorData?.vectorNetworkBlob
  if (blobIndex == null) return null
  const blob = ctx.blobs[blobIndex]
  if (!blob) return null
  const network = decodeVectorNetworkBlob(blob.bytes)
  if (!network) return null
  // Network coordinates are in normalizedSize space; scale to the node size
  const normalized = change.vectorData?.normalizedSize
  const scaleX = normalized?.x ? (change.size?.x ?? normalized.x) / normalized.x : 1
  const scaleY = normalized?.y ? (change.size?.y ?? normalized.y) / normalized.y : 1
  return vectorNetworkToPathData(network, scaleX, scaleY)
}

export function convertVectorLike(change: FigNodeChange, ctx: ConvertContext): PathNode | null {
  const base = buildBase(change, ctx, false)
  const stroke = resolveStroke(change, ctx)
  const fillGeometry =
    geometryFromPaths(change.fillGeometry, ctx) ?? geometryFromVectorNetwork(change, ctx)
  const strokeGeometry = geometryFromPaths(change.strokeGeometry, ctx)

  if (fillGeometry) {
    const node: PathNode = {
      type: 'path',
      ...base,
      geometry: fillGeometry.d,
      fillRule: fillGeometry.windingRule === 'ODD' ? 'evenodd' : 'nonzero',
    }
    if (stroke) {
      node.pathStroke = {
        align: stroke.align,
        thickness: stroke.width,
        join: change.strokeJoin ? change.strokeJoin.toLowerCase() : undefined,
        cap: change.strokeCap === 'ROUND' ? 'round' : change.strokeCap === 'SQUARE' ? 'square' : 'butt',
        fill: stroke.color,
      }
    }
    return node
  }

  if (strokeGeometry && stroke) {
    // Open path: Figma pre-computes the stroke outline; fill it with the
    // stroke paint for an exact visual match (caps, joins and dashes included).
    const node: PathNode = {
      type: 'path',
      ...base,
      geometry: strokeGeometry.d,
      fillRule: strokeGeometry.windingRule === 'ODD' ? 'evenodd' : 'nonzero',
      fill: stroke.color,
    }
    if (stroke.opacity != null) node.fillOpacity = stroke.opacity
    return node
  }

  ctx.warnings.push(`Vector "${change.name ?? 'node'}" has no geometry and was skipped`)
  return null
}

export function convertLine(change: FigNodeChange, ctx: ConvertContext): LineNode {
  const base = buildBase(change, ctx)
  return {
    type: 'line',
    ...base,
    points: [0, 0, base.width, base.height],
  }
}
