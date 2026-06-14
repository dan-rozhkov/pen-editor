// Conversion of a decoded Figma clipboard message into pen-editor SceneNodes.
//
// Coordinate model mapping:
// - Figma stores a relative 2x3 transform per node; the editor stores x/y
//   (top-left, relative to parent) + rotation in degrees applied around the
//   same origin — so x = m02, y = m12, rotation = atan2(m10, m00).
// - Figma children arrays are ordered bottom-to-top, same as the editor.
// - Auto-layout (Figma "stacks") maps onto the editor's flexbox layout:
//   direction/gap/padding/alignment on the frame, fill/hug sizing and
//   absolute positioning on children. The editor's layout engine recomputes
//   child positions on insert; with exact gap/padding and fixed child sizes
//   this reproduces Figma's coordinates (hugged text may drift by a few px
//   where font metrics differ).
//
// The implementation is split across the sibling `figmaToScene/` modules:
//   tree → paints → base → shapes/text/autoLayout → convertNode (recursive).
// This file owns only the public entry point and re-exports the public API.

import type { SceneNode } from '@/types/scene'
import type { FigPasteData } from './figTypes'
import { convertNode } from './figmaToScene/convertNode'
import { buildFigTree } from './figmaToScene/tree'
import type { ConvertContext, FigmaConversionResult } from './figmaToScene/types'

export type { FigmaConversionResult } from './figmaToScene/types'

/** Convert a decoded Figma clipboard payload into editor scene nodes (1:1 layout). */
export function convertFigmaPasteToSceneNodes(data: FigPasteData): FigmaConversionResult {
  const { roots, byGuid } = buildFigTree(data)
  const ctx: ConvertContext = {
    blobs: data.message.blobs ?? [],
    byGuid,
    warnings: [],
  }
  const nodes = roots
    .map((root) => convertNode(root, ctx))
    .filter((node): node is SceneNode => node != null)
  return { nodes, warnings: ctx.warnings }
}
