// Bottom-up size normalization for auto-layout `fit_content` frames.
//
// A pasted node carries the source app's *stored* width/height. For most nodes
// that is the true rendered size, but a Pixso component slot stores the size of
// its authored placeholder — after we resolve an INSTANCE_SWAP / component
// props, the slot frame holds far more (or different) content than its stored
// size reflects. The Pixi frame renderer clamps a clipped fit_content frame to
// `min(intrinsicContent, node.height)` (see frameRenderer.getFrameEffectiveSize
// — an intentional fix so a clipped hug frame doesn't expand past its authored
// bounds), so a stale-small stored size makes the clip mask collapse over the
// real content and it vanishes.
//
// This pass walks the converted tree post-order and grows each auto-layout
// fit_content frame's stored size to at least its children's laid-out extent,
// computed from the (already-normalized) child sizes. It only ever EXPANDS
// (`Math.max` with the stored value), so a frame whose stored size was already
// correct — every Figma paste, and most Pixso frames — is untouched, and any
// imprecision can only over-size (the renderer then re-clamps to the true
// intrinsic), never clip. Wrapping frames are skipped: the single-line formula
// would under-count their main axis and risk clipping.

import type { FrameNode, GroupNode, SceneNode } from '@/types/scene'

function childrenOf(node: SceneNode): SceneNode[] | undefined {
  if (node.type === 'frame' || node.type === 'group') {
    return (node as FrameNode | GroupNode).children
  }
  return undefined
}

/** In-flow, laid-out children: auto-layout excludes absolute + hidden nodes. */
function flowChildren(children: SceneNode[]): SceneNode[] {
  return children.filter((c) => c.absolutePosition !== true && c.visible !== false)
}

function normalizeFrame(frame: FrameNode): void {
  const layout = frame.layout
  if (!layout?.autoLayout || layout.flexWrap) return
  const fitWidth = frame.sizing?.widthMode === 'fit_content'
  const fitHeight = frame.sizing?.heightMode === 'fit_content'
  if (!fitWidth && !fitHeight) return

  const kids = flowChildren(frame.children)
  if (kids.length === 0) return

  const vertical = layout.flexDirection === 'column'
  const mainGap = (vertical ? layout.rowGap : layout.columnGap) ?? layout.gap ?? 0
  const padL = layout.paddingLeft ?? 0
  const padR = layout.paddingRight ?? 0
  const padT = layout.paddingTop ?? 0
  const padB = layout.paddingBottom ?? 0

  const sumMain = kids.reduce((s, c) => s + (vertical ? c.height : c.width), 0)
  const gaps = mainGap * (kids.length - 1)
  const maxCounter = kids.reduce((m, c) => Math.max(m, vertical ? c.width : c.height), 0)

  const contentWidth = vertical ? maxCounter + padL + padR : sumMain + gaps + padL + padR
  const contentHeight = vertical ? sumMain + gaps + padT + padB : maxCounter + padT + padB

  if (fitWidth) frame.width = Math.max(frame.width, contentWidth)
  if (fitHeight) frame.height = Math.max(frame.height, contentHeight)
}

/** Post-order walk: size children before their parents so nested hug frames
 *  contribute their already-corrected extents. */
export function normalizeFitContentSizes(nodes: SceneNode[]): void {
  for (const node of nodes) {
    const kids = childrenOf(node)
    if (kids) normalizeFitContentSizes(kids)
    if (node.type === 'frame') normalizeFrame(node as FrameNode)
  }
}
