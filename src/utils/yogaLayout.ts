import { loadYoga } from 'yoga-layout/load'
import type { Yoga, Node as YogaNode } from 'yoga-layout/load'
import type { SceneNode, FrameNode, LayoutProperties } from '../types/scene'

// Yoga instance (loaded asynchronously)
let yogaInstance: Yoga | null = null
let isInitialized = false
let initPromise: Promise<void> | null = null

/**
 * Initialize yoga-layout WASM module
 */
export async function initYoga(): Promise<void> {
  if (isInitialized) return
  if (initPromise) return initPromise

  initPromise = (async () => {
    yogaInstance = await loadYoga()
    isInitialized = true
    console.log('[Yoga] WASM module loaded successfully')
  })()

  return initPromise
}

/**
 * Check if yoga is ready to use
 */
export function isYogaReady(): boolean {
  return isInitialized && yogaInstance !== null
}

/**
 * Get the Yoga instance (throws if not initialized)
 */
export function getYoga(): Yoga {
  if (!yogaInstance) {
    throw new Error('Yoga not initialized. Call initYoga() first.')
  }
  return yogaInstance
}

// Map our AlignItems to Yoga constants
function mapAlignItems(align: LayoutProperties['alignItems']): number {
  const Y = getYoga()
  switch (align) {
    case 'flex-start': return Y.ALIGN_FLEX_START
    case 'center': return Y.ALIGN_CENTER
    case 'flex-end': return Y.ALIGN_FLEX_END
    case 'stretch': return Y.ALIGN_STRETCH
    default: return Y.ALIGN_FLEX_START
  }
}

// Map our JustifyContent to Yoga constants
function mapJustifyContent(justify: LayoutProperties['justifyContent']): number {
  const Y = getYoga()
  switch (justify) {
    case 'flex-start': return Y.JUSTIFY_FLEX_START
    case 'center': return Y.JUSTIFY_CENTER
    case 'flex-end': return Y.JUSTIFY_FLEX_END
    case 'space-between': return Y.JUSTIFY_SPACE_BETWEEN
    case 'space-around': return Y.JUSTIFY_SPACE_AROUND
    case 'space-evenly': return Y.JUSTIFY_SPACE_EVENLY
    default: return Y.JUSTIFY_FLEX_START
  }
}

// Map our FlexDirection to Yoga constants
function mapFlexDirection(direction: LayoutProperties['flexDirection']): number {
  const Y = getYoga()
  switch (direction) {
    case 'row': return Y.FLEX_DIRECTION_ROW
    case 'column': return Y.FLEX_DIRECTION_COLUMN
    default: return Y.FLEX_DIRECTION_ROW
  }
}

/**
 * Create a Yoga node for a Frame with layout properties
 */
export function createYogaNodeForFrame(frame: FrameNode): YogaNode {
  const Y = getYoga()
  const node = Y.Node.create()

  // Set frame dimensions
  node.setWidth(frame.width)
  node.setHeight(frame.height)

  // Apply layout properties if auto-layout is enabled
  const layout = frame.layout
  if (layout?.autoLayout) {
    // Flex direction
    node.setFlexDirection(mapFlexDirection(layout.flexDirection))

    // Gap
    if (layout.gap !== undefined) {
      node.setGap(Y.GUTTER_ALL, layout.gap)
    }

    // Padding
    if (layout.paddingTop !== undefined) {
      node.setPadding(Y.EDGE_TOP, layout.paddingTop)
    }
    if (layout.paddingRight !== undefined) {
      node.setPadding(Y.EDGE_RIGHT, layout.paddingRight)
    }
    if (layout.paddingBottom !== undefined) {
      node.setPadding(Y.EDGE_BOTTOM, layout.paddingBottom)
    }
    if (layout.paddingLeft !== undefined) {
      node.setPadding(Y.EDGE_LEFT, layout.paddingLeft)
    }

    // Alignment
    node.setAlignItems(mapAlignItems(layout.alignItems))
    node.setJustifyContent(mapJustifyContent(layout.justifyContent))
  }

  return node
}

/**
 * Create a Yoga child node for any scene node
 * Supports sizing modes: fixed, fill_container, fit_content
 * Handles nested auto-layout frames by computing their intrinsic size
 */
export function createYogaChildNode(child: SceneNode, parentLayout?: LayoutProperties): YogaNode {
  const Y = getYoga()
  const node = Y.Node.create()

  const widthMode = child.sizing?.widthMode ?? 'fixed'
  const heightMode = child.sizing?.heightMode ?? 'fixed'
  const isHorizontal = parentLayout?.flexDirection === 'row' || parentLayout?.flexDirection === undefined

  // Check if child is a nested auto-layout frame - use intrinsic size
  let effectiveWidth = child.width
  let effectiveHeight = child.height

  if (child.type === 'frame') {
    const frameChild = child as FrameNode
    if (frameChild.layout?.autoLayout && frameChild.children.length > 0) {
      const intrinsicSize = calculateFrameIntrinsicSize(frameChild)
      effectiveWidth = intrinsicSize.width
      effectiveHeight = intrinsicSize.height
      console.log('[Yoga] createYogaChildNode - nested frame intrinsic size', { childId: child.id, intrinsicSize })
    }
  }

  console.log('[Yoga] createYogaChildNode', { childId: child.id, widthMode, heightMode, isHorizontal, effectiveWidth, effectiveHeight })

  // Width handling
  if (widthMode === 'fixed') {
    node.setWidth(effectiveWidth)
  } else if (widthMode === 'fill_container') {
    // On main axis (row): use flexGrow to fill available space
    // On cross axis (column): use alignSelf stretch
    if (isHorizontal) {
      node.setFlexGrow(1)
      node.setFlexShrink(1)
      node.setFlexBasis(0) // Start from 0 and grow
    } else {
      node.setAlignSelf(Y.ALIGN_STRETCH)
    }
  } else if (widthMode === 'fit_content') {
    // For nested auto-layout frames, use their computed intrinsic size
    if (child.type === 'frame' && (child as FrameNode).layout?.autoLayout) {
      node.setWidth(effectiveWidth)
    }
    // For non-frame nodes, let Yoga calculate based on content
  }

  // Height handling
  if (heightMode === 'fixed') {
    node.setHeight(effectiveHeight)
  } else if (heightMode === 'fill_container') {
    // On main axis (column): use flexGrow to fill available space
    // On cross axis (row): use alignSelf stretch
    if (!isHorizontal) {
      node.setFlexGrow(1)
      node.setFlexShrink(1)
      node.setFlexBasis(0) // Start from 0 and grow
    } else {
      node.setAlignSelf(Y.ALIGN_STRETCH)
    }
  } else if (heightMode === 'fit_content') {
    // For nested auto-layout frames, use their computed intrinsic size
    if (child.type === 'frame' && (child as FrameNode).layout?.autoLayout) {
      node.setHeight(effectiveHeight)
    }
    // For non-frame nodes, let Yoga calculate based on content
  }

  return node
}

export interface LayoutResult {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * Calculate the intrinsic (fit-content) size of a frame based on its children.
 * Used for nested auto-layout frames to determine their natural size.
 */
export function calculateFrameIntrinsicSize(frame: FrameNode): { width: number; height: number } {
  if (!isYogaReady()) {
    return { width: frame.width, height: frame.height }
  }

  const Y = getYoga()
  const rootNode = Y.Node.create()

  // Apply layout properties (direction, gap, padding, alignment)
  const layout = frame.layout
  if (layout?.autoLayout) {
    rootNode.setFlexDirection(mapFlexDirection(layout.flexDirection))
    if (layout.gap !== undefined) {
      rootNode.setGap(Y.GUTTER_ALL, layout.gap)
    }
    if (layout.paddingTop !== undefined) {
      rootNode.setPadding(Y.EDGE_TOP, layout.paddingTop)
    }
    if (layout.paddingRight !== undefined) {
      rootNode.setPadding(Y.EDGE_RIGHT, layout.paddingRight)
    }
    if (layout.paddingBottom !== undefined) {
      rootNode.setPadding(Y.EDGE_BOTTOM, layout.paddingBottom)
    }
    if (layout.paddingLeft !== undefined) {
      rootNode.setPadding(Y.EDGE_LEFT, layout.paddingLeft)
    }
    rootNode.setAlignItems(mapAlignItems(layout.alignItems))
    rootNode.setJustifyContent(mapJustifyContent(layout.justifyContent))
  }

  // Add children with their sizes (recursive for nested frames)
  const visibleChildren = frame.children.filter(c => c.visible !== false)
  visibleChildren.forEach((child, index) => {
    const childNode = createYogaChildNodeWithIntrinsicSize(child, layout)
    rootNode.insertChild(childNode, index)
  })

  // Calculate layout without fixed dimensions to get intrinsic size
  rootNode.calculateLayout(undefined, undefined, Y.DIRECTION_LTR)
  const computed = rootNode.getComputedLayout()
  rootNode.freeRecursive()

  console.log('[Yoga] calculateFrameIntrinsicSize', { frameId: frame.id, width: computed.width, height: computed.height })
  return { width: computed.width, height: computed.height }
}

/**
 * Create a Yoga child node that accounts for nested auto-layout frames.
 * For nested frames with autoLayout, recursively calculates their intrinsic size.
 */
function createYogaChildNodeWithIntrinsicSize(child: SceneNode, parentLayout?: LayoutProperties): YogaNode {
  const Y = getYoga()
  const node = Y.Node.create()

  // Check if child is a nested auto-layout frame
  let effectiveWidth = child.width
  let effectiveHeight = child.height

  if (child.type === 'frame') {
    const frameChild = child as FrameNode
    if (frameChild.layout?.autoLayout && frameChild.children.length > 0) {
      // Recursively calculate intrinsic size of nested auto-layout frame
      const intrinsicSize = calculateFrameIntrinsicSize(frameChild)
      effectiveWidth = intrinsicSize.width
      effectiveHeight = intrinsicSize.height
      console.log('[Yoga] nested frame intrinsic size', { childId: child.id, intrinsicSize })
    }
  }

  const widthMode = child.sizing?.widthMode ?? 'fixed'
  const heightMode = child.sizing?.heightMode ?? 'fixed'
  const isHorizontal = parentLayout?.flexDirection === 'row' || parentLayout?.flexDirection === undefined

  // Width handling
  if (widthMode === 'fixed') {
    node.setWidth(effectiveWidth)
  } else if (widthMode === 'fill_container') {
    if (isHorizontal) {
      node.setFlexGrow(1)
      node.setFlexShrink(1)
      node.setFlexBasis(0)
    } else {
      node.setAlignSelf(Y.ALIGN_STRETCH)
    }
  }
  // fit_content: don't set width, let Yoga compute

  // Height handling
  if (heightMode === 'fixed') {
    node.setHeight(effectiveHeight)
  } else if (heightMode === 'fill_container') {
    if (!isHorizontal) {
      node.setFlexGrow(1)
      node.setFlexShrink(1)
      node.setFlexBasis(0)
    } else {
      node.setAlignSelf(Y.ALIGN_STRETCH)
    }
  }
  // fit_content: don't set height, let Yoga compute

  return node
}

/**
 * Calculate layout for a Frame and its children
 * Returns updated positions for all children
 */
export function calculateFrameLayout(frame: FrameNode): LayoutResult[] {
  if (!isYogaReady()) {
    console.warn('[Yoga] Not initialized, skipping layout calculation')
    return []
  }

  // Only calculate if auto-layout is enabled
  if (!frame.layout?.autoLayout) {
    return []
  }

  const Y = getYoga()
  const results: LayoutResult[] = []

  // Create root yoga node for the frame
  const rootNode = createYogaNodeForFrame(frame)

  // Create yoga nodes for visible children
  const visibleChildren = frame.children.filter(c => c.visible !== false)
  const childNodes: YogaNode[] = []

  visibleChildren.forEach((child, index) => {
    const childNode = createYogaChildNode(child, frame.layout)
    rootNode.insertChild(childNode, index)
    childNodes.push(childNode)
  })

  // Calculate layout
  rootNode.calculateLayout(frame.width, frame.height, Y.DIRECTION_LTR)

  // Extract computed positions for children
  visibleChildren.forEach((child, index) => {
    const computed = childNodes[index].getComputedLayout()
    console.log('[Yoga] computed layout for', child.id, computed)
    results.push({
      id: child.id,
      x: computed.left,
      y: computed.top,
      width: computed.width,
      height: computed.height,
    })
  })

  // Clean up yoga nodes
  rootNode.freeRecursive()

  return results
}

/**
 * Apply layout results to scene nodes
 * Returns a new array with updated positions and sizes based on sizing mode
 */
export function applyLayoutToChildren(
  children: SceneNode[],
  layoutResults: LayoutResult[]
): SceneNode[] {
  const resultMap = new Map(layoutResults.map(r => [r.id, r]))

  return children.map(child => {
    const result = resultMap.get(child.id)
    if (result) {
      const widthMode = child.sizing?.widthMode ?? 'fixed'
      const heightMode = child.sizing?.heightMode ?? 'fixed'

      const newWidth = widthMode !== 'fixed' ? result.width : child.width
      const newHeight = heightMode !== 'fixed' ? result.height : child.height

      console.log('[Yoga] applyLayoutToChildren', {
        id: child.id,
        widthMode,
        heightMode,
        originalWidth: child.width,
        computedWidth: result.width,
        newWidth,
        originalHeight: child.height,
        computedHeight: result.height,
        newHeight
      })

      return {
        ...child,
        x: result.x,
        y: result.y,
        width: newWidth,
        height: newHeight,
      }
    }
    return child
  })
}
