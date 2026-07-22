// Container/mask/instance handling and the recursive node dispatcher.

import type { FrameNode, GroupNode, SceneNode, SizingProperties } from '@/types/scene'
import { figGuidKey, type FigNodeChange } from '../figTypes'
import { applyStackChildProps, buildAutoLayout, hugSizing, isStackContainer } from './autoLayout'
import { buildBase, perCornerRadius } from './base'
import { buildComponentPropMap, resolveComponentProps } from './componentProps'
import { buildOverrideMap, mergeChange } from './overrides'
import { convertEllipse, convertLine, convertRect, convertVectorLike } from './shapes'
import { convertText } from './text'
import type { ConvertContext, FigTreeNode } from './types'

function isMaskChange(change: FigNodeChange): boolean {
  return change.mask === true
}

function fullyCovers(outer: SceneNode, inner: SceneNode): boolean {
  return (
    outer.x <= inner.x + 0.5 &&
    outer.y <= inner.y + 0.5 &&
    outer.x + outer.width >= inner.x + inner.width - 0.5 &&
    outer.y + outer.height >= inner.y + inner.height - 0.5
  )
}

/**
 * Best-effort Figma mask emulation (the editor clips with frames only):
 * - mask + a single image layer covering it → image fill on the mask shape
 * - otherwise the mask shape is hidden and a warning is recorded
 */
function applyMaskWorkarounds(
  figChildren: FigTreeNode[],
  converted: (SceneNode | null)[],
  ctx: ConvertContext,
): SceneNode[] {
  const maskIndex = figChildren.findIndex(
    (child, i) => isMaskChange(child.change) && converted[i] != null,
  )
  if (maskIndex === -1) {
    return converted.filter((node): node is SceneNode => node != null)
  }

  const maskNode = converted[maskIndex] as SceneNode
  const above = converted.filter(
    (node, i): node is SceneNode => node != null && i > maskIndex,
  )

  const onlyImage =
    above.length === 1 &&
    above[0].imageFill != null &&
    (above[0].type === 'rect' || above[0].type === 'frame') &&
    fullyCovers(above[0], maskNode) &&
    (maskNode.type === 'rect' || maskNode.type === 'ellipse')
  if (onlyImage) {
    maskNode.imageFill = { ...above[0].imageFill!, mode: 'fill' }
    return converted.filter(
      (node, i): node is SceneNode => node != null && node !== above[0] && i <= maskIndex,
    )
  }

  ctx.warnings.push(
    `Mask "${maskNode.name ?? 'mask'}" is not supported and was hidden; content is left unclipped`,
  )
  maskNode.visible = false
  return converted.filter((node): node is SceneNode => node != null)
}

function convertChildren(
  figChildren: FigTreeNode[],
  ctx: ConvertContext,
  parentChange?: FigNodeChange,
): SceneNode[] {
  const parentIsStack = parentChange != null && isStackContainer(parentChange)
  const converted = figChildren.map((child) => {
    const node = convertNode(child, ctx)
    if (node && parentIsStack) {
      applyStackChildProps(node, child.change, parentChange)
    }
    return node
  })
  return applyMaskWorkarounds(figChildren, converted, ctx)
}

function convertFrame(node: FigTreeNode, change: FigNodeChange, ctx: ConvertContext): FrameNode | GroupNode {
  const isGroup = change.type === 'GROUP' || change.resizeToFit === true
  const children = convertChildren(node.children, ctx, change)

  if (isGroup) {
    const base = buildBase(change, ctx)
    // Figma groups have no own paints — drop accidental ones
    return { type: 'group', ...base, children }
  }

  const frame: FrameNode = {
    type: 'frame',
    ...buildBase(change, ctx),
    children,
    clip: change.type === 'SECTION' ? false : change.frameMaskDisabled !== true,
  }
  if (change.cornerRadius) frame.cornerRadius = change.cornerRadius
  const corners = perCornerRadius(change)
  if (corners) frame.cornerRadiusPerCorner = corners

  const layout = buildAutoLayout(change)
  if (layout) {
    frame.layout = layout
    // Hug sizing on the stack frame itself (when it is not a stack child,
    // applyStackChildProps does not run for it — e.g. pasted as a root)
    if (!frame.sizing) {
      const hug = hugSizing(change)
      const sizing: SizingProperties = {}
      if (hug.width) sizing.widthMode = 'fit_content'
      if (hug.height) sizing.heightMode = 'fit_content'
      if (sizing.widthMode || sizing.heightMode) frame.sizing = sizing
    }
  }
  return frame
}

function convertInstance(change: FigNodeChange, ctx: ConvertContext): SceneNode | null {
  // A swapped-in instance (INSTANCE_SWAP component prop, or a direct
  // override) points at a different master than the one the node was
  // authored against — prefer it when present.
  const symbolGuid = change.overriddenSymbolID ?? change.symbolData?.symbolID
  const symbolKey = symbolGuid ? figGuidKey(symbolGuid) : ''
  const symbol = symbolKey ? ctx.byGuid.get(symbolKey) : undefined
  if (!symbol) {
    ctx.warnings.push(
      `Component instance "${change.name ?? 'instance'}" has no master in the clipboard; pasted as a plain frame`,
    )
    const base = buildBase(change, ctx)
    return { type: 'frame', ...base, children: [], clip: true }
  }

  // Wrapper frame: symbol defaults + instance-level overrides (size, transform,
  // fills…); mergeChange skips undefined fields and keeps type pinned to FRAME
  const mergedChange = mergeChange({ ...symbol.change, type: 'FRAME' }, change)

  const componentProps = buildComponentPropMap(
    change,
    ctx.componentProps,
    symbol.change.componentPropDef,
  )
  const instanceCtx: ConvertContext = {
    ...ctx,
    instance: { overrides: buildOverrideMap(change), path: [] },
    componentProps,
  }
  // The master's own root frame can carry component-prop bindings (e.g. a
  // VISIBLE or OVERRIDDEN_SYMBOL_ID declared on the outer frame). Descendants
  // are resolved in convertNode; resolve the root here since it bypasses that
  // entry path.
  const resolvedRoot = resolveComponentProps(mergedChange, componentProps)
  const frame = convertFrame(
    { change: resolvedRoot, children: symbol.children },
    resolvedRoot,
    instanceCtx,
  )
  return frame
}

export function convertNode(node: FigTreeNode, ctx: ConvertContext): SceneNode | null {
  let change = node.change

  // Apply instance overrides addressed to this node's guid path
  if (ctx.instance && change.guid) {
    const path = [...ctx.instance.path, figGuidKey(change.guid)]
    const override = ctx.instance.overrides.get(path.join('/'))
    if (override) change = mergeChange(change, override)
    ctx = { ...ctx, instance: { ...ctx.instance, path } }
  }

  // Resolve this node's own component-property bindings (a no-op unless the
  // node declares componentPropRef and the enclosing instance supplied a
  // matching value).
  change = resolveComponentProps(change, ctx.componentProps)

  switch (change.type) {
    case 'FRAME':
    case 'SECTION':
    case 'GROUP':
      return convertFrame(node, change, ctx)
    case 'SYMBOL':
      // A component master copied directly — paste as a regular frame
      return convertFrame(node, { ...change, type: 'FRAME' }, ctx)
    case 'INSTANCE':
      return convertInstance(change, ctx)
    case 'RECTANGLE':
    case 'ROUNDED_RECTANGLE':
      return convertRect(change, ctx)
    case 'ELLIPSE': {
      const arc = change.arcData
      const isFullEllipse =
        !arc ||
        ((arc.innerRadius ?? 0) === 0 &&
          Math.abs((arc.endingAngle ?? Math.PI * 2) - (arc.startingAngle ?? 0)) >= Math.PI * 2 - 1e-3)
      if (isFullEllipse) return convertEllipse(change, ctx)
      return convertVectorLike(change, ctx)
    }
    case 'LINE':
      return convertLine(change, ctx)
    case 'TEXT':
      return convertText(change, ctx)
    case 'VECTOR':
    case 'STAR':
    case 'REGULAR_POLYGON':
    case 'BOOLEAN_OPERATION':
    case 'HIGHLIGHT':
      return convertVectorLike(change, ctx)
    case 'SLICE':
    case 'WIDGET':
    case 'STAMP':
    case 'CONNECTOR':
    case 'STICKY':
    case 'CODE_BLOCK':
      return null
    default:
      // Unknown/new node type: salvage what we can through derived geometry
      if (change.fillGeometry?.length || change.strokeGeometry?.length) {
        return convertVectorLike(change, ctx)
      }
      ctx.warnings.push(`Unsupported Figma node type "${change.type ?? 'UNKNOWN'}" was skipped`)
      return null
  }
}
