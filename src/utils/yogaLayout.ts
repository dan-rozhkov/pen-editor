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
 */
export function createYogaChildNode(child: SceneNode): YogaNode {
  const Y = getYoga()
  const node = Y.Node.create()

  node.setWidth(child.width)
  node.setHeight(child.height)

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
    const childNode = createYogaChildNode(child)
    rootNode.insertChild(childNode, index)
    childNodes.push(childNode)
  })

  // Calculate layout
  rootNode.calculateLayout(frame.width, frame.height, Y.DIRECTION_LTR)

  // Extract computed positions for children
  visibleChildren.forEach((child, index) => {
    const computed = childNodes[index].getComputedLayout()
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
 * Returns a new array with updated positions
 */
export function applyLayoutToChildren(
  children: SceneNode[],
  layoutResults: LayoutResult[]
): SceneNode[] {
  const resultMap = new Map(layoutResults.map(r => [r.id, r]))

  return children.map(child => {
    const result = resultMap.get(child.id)
    if (result) {
      return {
        ...child,
        x: result.x,
        y: result.y,
        // Optionally update size if needed
        // width: result.width,
        // height: result.height,
      }
    }
    return child
  })
}
