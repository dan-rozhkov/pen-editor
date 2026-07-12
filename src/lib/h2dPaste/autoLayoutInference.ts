// Conservative auto-layout inference for h2d clipboard paste.
//
// Goal: enable auto-layout on a converted frame ONLY when the editor's own
// (pure) layout engine can reproduce the captured child rects EXACTLY from a
// CSS-derived candidate. A wrong auto-layout silently breaks a pasted design
// on the next resize/edit, which is worse than leaving it absolutely
// positioned — so this module always prefers returning `null` over guessing.
//
// Pure — no DOM APIs — so it works the same in the browser and under a
// happy-dom test environment, and composes with `calculateFrameLayout`
// (also pure) as its own verifier.
//
// Invariant this module leans on: h2d-pasted frames/children always keep
// sizing 'fixed' (v2 never infers fill/hug — see `h2dToScene.ts`). That's
// what lets `verifyAutoLayout` trust a one-time replay: with fixed sizing, no
// ancestor's later layout pass can resize a verified frame or its children
// and invalidate the verification. If fill/hug sizing is ever added to the
// h2d import path, this invariant breaks and verified frames would need
// re-checking whenever an ancestor's layout changes.

import type { AlignItems, FlexDirection, FrameNode, JustifyContent, LayoutProperties } from '@/types/scene'
import { CSS_ALIGN_ITEMS_MAP, CSS_JUSTIFY_CONTENT_MAP } from '@/lib/htmlToDesign/layoutInference'
import { calculateFrameLayout } from '@/utils/yogaLayout'
import { px } from './h2dToScene'

// Layered on top of htmlToDesign's shared maps: v2 keeps every child's sizing
// 'fixed' (see module doc), so `stretch` (cross-axis fill) has no visible
// effect — the child's cross-start edge lands in the same place as
// `flex-start`. Map it there rather than bailing, since it's the CSS-flex
// default (`align-items: normal` computes to `stretch` for flex items) and
// would otherwise disqualify almost every real-world flex container.
// htmlToDesign's map doesn't need this because it isn't gated on an exact
// pixel-perfect replay the way this module is.
const ALIGN_ITEMS_MAP: Record<string, AlignItems> = {
  ...CSS_ALIGN_ITEMS_MAP,
  stretch: 'flex-start',
  normal: 'flex-start',
}

const JUSTIFY_CONTENT_MAP: Record<string, JustifyContent> = {
  ...CSS_JUSTIFY_CONTENT_MAP,
  normal: 'flex-start',
}

/**
 * Derive a CANDIDATE auto-layout config from an element's resolved CSS and
 * its (already-converted) flow children — or `null` when the container
 * isn't representable by the engine (grid, plain flow, reversed direction,
 * wrap-reverse, out-of-flow children, non-px gap, or an unsupported
 * align-items value such as `baseline`). v2 deliberately skips grid and
 * plain-flow inference (flex only).
 *
 * `childStyles` must be the resolved styles of the SAME elements that ended
 * up as `frame.children`, in the same order — used only to check for
 * `position: absolute|fixed` children, which the engine has no way to
 * reproduce (it has no CSS position model).
 */
export function inferAutoLayout(
  styles: Record<string, string>,
  frame: FrameNode,
  childStyles: Record<string, string>[],
): LayoutProperties | null {
  const display = styles.display
  if (display !== 'flex' && display !== 'inline-flex') return null
  if (frame.children.length === 0) return null

  // The engine has no reverse-direction / wrap-reverse support.
  const rawDirection = styles.flexDirection
  if (rawDirection === 'row-reverse' || rawDirection === 'column-reverse') return null
  const flexDirection: FlexDirection = rawDirection === 'column' ? 'column' : 'row'

  const rawWrap = styles.flexWrap
  if (rawWrap === 'wrap-reverse') return null
  const flexWrap = rawWrap === 'wrap'

  if (childStyles.some((s) => s.position === 'absolute' || s.position === 'fixed')) return null

  // Resolved values like '16px' are expected; an unparseable non-px value
  // ('normal', a percentage, ...) means we can't reproduce the real gap —
  // bail rather than silently drop it. A genuinely absent key (not present
  // in the captured styles at all) means "not set" => 0.
  const columnGap = styles.columnGap === undefined ? 0 : px(styles.columnGap)
  const rowGap = styles.rowGap === undefined ? 0 : px(styles.rowGap)
  if (columnGap === null || rowGap === null) return null

  // Same "absent key => 0, present-but-unparseable => bail" rule as gap above
  // (a resolved '5%' or similar means we can't reproduce the real padding).
  const paddingTop = styles.paddingTop === undefined ? 0 : px(styles.paddingTop)
  const paddingRight = styles.paddingRight === undefined ? 0 : px(styles.paddingRight)
  const paddingBottom = styles.paddingBottom === undefined ? 0 : px(styles.paddingBottom)
  const paddingLeft = styles.paddingLeft === undefined ? 0 : px(styles.paddingLeft)
  if (paddingTop === null || paddingRight === null || paddingBottom === null || paddingLeft === null) return null

  const rawAlign = styles.alignItems
  const alignItems = rawAlign !== undefined ? ALIGN_ITEMS_MAP[rawAlign] : undefined
  if (rawAlign !== undefined && alignItems === undefined) return null // e.g. 'baseline'

  const rawJustify = styles.justifyContent
  const justifyContent = rawJustify !== undefined ? JUSTIFY_CONTENT_MAP[rawJustify] : undefined
  if (rawJustify !== undefined && justifyContent === undefined) return null

  const candidate: LayoutProperties = { autoLayout: true, flexDirection }
  if (flexWrap) {
    candidate.flexWrap = true
    // Multi-line: rowGap (between lines) and columnGap (between items in a
    // line) are independently meaningful, so keep them split when they
    // differ. AutoLayoutSection only exposes split Row/Column gap inputs
    // when flexWrap is on (see module doc below) — this must stay gated the
    // same way.
    if (columnGap !== rowGap) {
      candidate.rowGap = rowGap
      candidate.columnGap = columnGap
    } else if (columnGap !== 0) {
      candidate.gap = columnGap
    }
  } else {
    // Single-line flex: only the MAIN-axis gap (columnGap for row direction,
    // rowGap for column direction) has any visual effect — there's no second
    // line for the cross-axis gap to apply to — so collapsing to one `gap`
    // value is exact, not a guess. This also matches AutoLayoutSection's UI:
    // when flexWrap is falsy it renders a single "Gap" input bound to
    // `layout.gap` (properties/AutoLayoutSection.tsx), so a non-wrap
    // candidate with split rowGap/columnGap would (a) display "Gap: 0" and
    // (b) make user edits to that input a silent no-op, since stale
    // rowGap/columnGap would keep winning in yogaLayout's buildContainer.
    const mainGap = flexDirection === 'row' ? columnGap : rowGap
    if (mainGap !== 0) candidate.gap = mainGap
  }
  if (paddingTop) candidate.paddingTop = paddingTop
  if (paddingRight) candidate.paddingRight = paddingRight
  if (paddingBottom) candidate.paddingBottom = paddingBottom
  if (paddingLeft) candidate.paddingLeft = paddingLeft
  if (alignItems) candidate.alignItems = alignItems
  if (justifyContent) candidate.justifyContent = justifyContent

  return candidate
}

/**
 * Fidelity check: does replaying `candidate` through the editor's real
 * layout engine reproduce every flow child's captured rect (within
 * `tolerancePx`)? Sizes are asserted too, defensively — v2 keeps every
 * child's sizing 'fixed', so `calculateFrameLayout` should never move them,
 * but a mismatch there means our assumptions about the engine are wrong and
 * we must not apply the candidate.
 */
export function verifyAutoLayout(frame: FrameNode, candidate: LayoutProperties, tolerancePx = 1): boolean {
  const candidateFrame: FrameNode = { ...frame, layout: candidate }
  const results = calculateFrameLayout(candidateFrame)

  // Must mirror calculateFrameLayout's own flow-child filter exactly
  // (utils/yogaLayout.ts, `calculateFrameLayout` — `visible !== false &&
  // enabled !== false && !absolutePosition`), or `results.length` above can
  // silently disagree with `flowChildren.length` and this check either
  // false-negatives on a real match or, worse, compares the wrong children
  // and false-positives. Keep the two filters in sync if either changes.
  const flowChildren = frame.children.filter((c) => c.visible !== false && c.enabled !== false && !c.absolutePosition)
  if (results.length !== flowChildren.length) return false

  const byId = new Map(results.map((r) => [r.id, r]))
  for (const child of flowChildren) {
    const result = byId.get(child.id)
    if (!result) return false
    if (Math.abs(result.x - child.x) > tolerancePx) return false
    if (Math.abs(result.y - child.y) > tolerancePx) return false
    if (Math.abs(result.width - child.width) > tolerancePx) return false
    if (Math.abs(result.height - child.height) > tolerancePx) return false
  }
  return true
}

/**
 * Derive + verify + apply, in one step. Mutates `frame.layout` only when a
 * candidate exists AND reproduces the captured rects exactly; otherwise
 * leaves the frame's (already-set) absolute child positions untouched.
 */
export function maybeApplyAutoLayout(frame: FrameNode, styles: Record<string, string>, childStyles: Record<string, string>[]): void {
  const candidate = inferAutoLayout(styles, frame, childStyles)
  if (!candidate) return
  if (!verifyAutoLayout(frame, candidate)) return
  frame.layout = candidate
}
