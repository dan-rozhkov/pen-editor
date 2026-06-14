// Auto-layout mapping: Figma "stacks" → the editor's flexbox layout, including
// child fill/hug sizing and absolute positioning.

import type {
  AlignItems,
  JustifyContent,
  LayoutProperties,
  SceneNode,
  SizingMode,
  SizingProperties,
} from '@/types/scene'
import type { FigNodeChange } from '../figTypes'

export function isStackContainer(change: FigNodeChange): boolean {
  return change.stackMode === 'HORIZONTAL' || change.stackMode === 'VERTICAL'
}

function isHugSizing(sizing: string | undefined): boolean {
  return sizing === 'RESIZE_TO_FIT' || sizing === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE'
}

const STACK_JUSTIFY: Record<string, JustifyContent> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  SPACE_EVENLY: 'space-between',
}

const STACK_ALIGN: Record<string, AlignItems> = {
  MIN: 'flex-start',
  CENTER: 'center',
  MAX: 'flex-end',
  BASELINE: 'center',
}

export function buildAutoLayout(change: FigNodeChange): LayoutProperties | null {
  if (!isStackContainer(change)) return null
  const justify = STACK_JUSTIFY[change.stackPrimaryAlignItems ?? 'MIN'] ?? 'flex-start'
  return {
    autoLayout: true,
    flexDirection: change.stackMode === 'VERTICAL' ? 'column' : 'row',
    // Figma ignores the stored item spacing in "space between" mode
    gap: justify === 'space-between' ? 0 : change.stackSpacing ?? 0,
    paddingTop: change.stackVerticalPadding ?? 0,
    paddingRight: change.stackPaddingRight ?? 0,
    paddingBottom: change.stackPaddingBottom ?? 0,
    paddingLeft: change.stackHorizontalPadding ?? 0,
    alignItems: STACK_ALIGN[change.stackCounterAlignItems ?? 'MIN'] ?? 'flex-start',
    justifyContent: justify,
  }
}

/** Hug-content sizing of a node itself (auto-layout frames and text). */
export function hugSizing(change: FigNodeChange): { width: boolean; height: boolean } {
  if (change.stackMode === 'HORIZONTAL') {
    return {
      width: isHugSizing(change.stackPrimarySizing),
      height: isHugSizing(change.stackCounterSizing),
    }
  }
  if (change.stackMode === 'VERTICAL') {
    return {
      width: isHugSizing(change.stackCounterSizing),
      height: isHugSizing(change.stackPrimarySizing),
    }
  }
  if (change.type === 'TEXT') {
    return {
      width: change.textAutoResize === 'WIDTH_AND_HEIGHT',
      height: change.textAutoResize === 'WIDTH_AND_HEIGHT' || change.textAutoResize === 'HEIGHT',
    }
  }
  return { width: false, height: false }
}

function stackSizing(fill: boolean, hug: boolean): SizingMode | undefined {
  if (fill) return 'fill_container'
  if (hug) return 'fit_content'
  return undefined
}

/**
 * Sizing and positioning of a child inside an auto-layout parent:
 * fill (grow/stretch), hug (its own content sizing) or fixed; absolutely
 * positioned children are excluded from the flow.
 */
export function applyStackChildProps(
  node: SceneNode,
  childChange: FigNodeChange,
  parentChange: FigNodeChange,
): void {
  if (childChange.stackPositioning === 'ABSOLUTE') {
    node.absolutePosition = true
    return
  }
  const horizontal = parentChange.stackMode === 'HORIZONTAL'
  const fillPrimary = (childChange.stackChildPrimaryGrow ?? 0) > 0
  const fillCounter = childChange.stackChildAlignSelf === 'STRETCH'
  const hug = hugSizing(childChange)

  const widthMode = stackSizing(horizontal ? fillPrimary : fillCounter, hug.width)
  const heightMode = stackSizing(horizontal ? fillCounter : fillPrimary, hug.height)
  if (widthMode || heightMode) {
    const sizing: SizingProperties = {}
    if (widthMode) sizing.widthMode = widthMode
    if (heightMode) sizing.heightMode = heightMode
    node.sizing = sizing
  }
}
