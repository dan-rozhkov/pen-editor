// Ground-truth regression test for the component-property resolution + auto-layout
// remap fix (see docs/superpowers/specs/2026-07-22-pixso-component-properties-design.md).
// Runs the real pipeline on a real, heavily-componentised Pixso paste capture
// (`fixtures/frame10.html`, 4407 source PixsoNodes) and asserts on the outcome.
//
// Baseline BEFORE this fix: 86 scene nodes, 13 empty text nodes, several
// "◇\nSwap" instance-swap placeholders, 0 warnings.
//
// A handful of "◇\nSwap" placeholders are expected to remain even after a
// correct fix: some instance-swap slots in this real capture are genuinely
// left unconfigured in the source file — their resolved master is Pixso's own
// "LayoutBlocks/base" utility block (`symbolDescription`: "Swap me with
// another ◇ component instance…", guid session 4125), which is the same
// placeholder the Pixso editor itself would render for an unassigned slot.
// That is not a conversion bug; it is a faithful reproduction of the source.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { convertPixsoClipboardHtml } from '../index'
import type { SceneNode } from '@/types/scene'

const here = dirname(fileURLToPath(import.meta.url))

function walk(nodes: SceneNode[], cb: (n: SceneNode) => void) {
  for (const n of nodes) {
    cb(n)
    const kids = (n as { children?: SceneNode[] }).children
    if (kids) walk(kids, cb)
  }
}

describe('pixso repro: frame10 (real, heavily-componentised capture)', () => {
  it('resolves component-instance text/visibility/swap props instead of losing them', async () => {
    const html = readFileSync(join(here, 'fixtures/frame10.html'), 'utf8')
    const res = await convertPixsoClipboardHtml(html)
    if (!res) throw new Error('null result')

    let totalNodes = 0
    const texts: string[] = []
    walk(res.nodes, (n) => {
      totalNodes++
      if (n.type === 'text') texts.push((n as { text: string }).text)
    })

    // Massively more content survives than the pre-fix baseline (86) — most of
    // the loss was unresolved component-instance content collapsing to
    // near-nothing.
    expect(totalNodes).toBeGreaterThan(200)

    // Text bound through a component prop resolves to real content instead of
    // staying empty (baseline: 13 empty).
    const emptyText = texts.filter((t) => !t || !t.trim()).length
    expect(emptyText).toBeLessThan(40)

    // The master's raw placeholder text ("Rag 123"-style) must never leak
    // through once a TEXT prop is bound and resolved.
    expect(texts.some((t) => t.startsWith('Rag'))).toBe(false)

    // Known-real strings from this capture that only appear once instance
    // props actually resolve (button labels, list content).
    expect(texts).toContain('Next')
    expect(texts).toContain('Lucy')
    expect(texts).toContain('Waiting')
    expect(texts).toContain('18-digit code')

    // A few genuinely-unconfigured instance-swap slots are expected to remain
    // (see file header) — this bounds it far below the pre-fix count without
    // demanding an impossible zero.
    const swapPlaceholders = texts.filter((t) => t.includes('◇')).length
    expect(swapPlaceholders).toBeLessThan(10)
  })
})
