import { describe, expect, it } from 'vitest'
import type { FrameNode, SceneNode } from '@/types/scene'
import { normalizeFitContentSizes } from '../figmaToScene/fitContentSize'

function frame(partial: Partial<FrameNode> & { id: string }): FrameNode {
  return {
    type: 'frame',
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    name: partial.id,
    children: [],
    ...partial,
  } as FrameNode
}

function textNode(id: string, w: number, h: number): SceneNode {
  return { type: 'text', id, name: id, x: 0, y: 0, width: w, height: h, text: id } as SceneNode
}

describe('normalizeFitContentSizes', () => {
  it('grows a vertical hug frame to the sum of children + gaps + padding', () => {
    const f = frame({
      id: 'f',
      width: 0,
      height: 32, // stale/too small
      sizing: { heightMode: 'fit_content', widthMode: 'fit_content' },
      layout: { autoLayout: true, flexDirection: 'column', gap: 10, paddingTop: 8, paddingBottom: 8, paddingLeft: 4, paddingRight: 4 },
      children: [textNode('a', 50, 20), textNode('b', 70, 20), textNode('c', 30, 20)],
    })
    normalizeFitContentSizes([f])
    // height = 20*3 + 10*2 (gaps) + 8 + 8 = 96 ; width = max(50,70,30)+4+4 = 78
    expect(f.height).toBe(96)
    expect(f.width).toBe(78)
  })

  it('only expands — a frame already larger than its content is left alone', () => {
    const f = frame({
      id: 'f',
      width: 500,
      height: 500,
      sizing: { heightMode: 'fit_content' },
      layout: { autoLayout: true, flexDirection: 'column', gap: 0 },
      children: [textNode('a', 10, 10)],
    })
    normalizeFitContentSizes([f])
    expect(f.height).toBe(500)
  })

  it('is a no-op for a non-auto-layout frame', () => {
    const f = frame({
      id: 'f',
      width: 10,
      height: 10,
      sizing: { heightMode: 'fit_content' },
      children: [textNode('a', 100, 100)],
    })
    normalizeFitContentSizes([f])
    expect(f.height).toBe(10)
  })

  it('excludes absolute and hidden children from the flow extent', () => {
    const f = frame({
      id: 'f',
      width: 0,
      height: 0,
      sizing: { heightMode: 'fit_content' },
      layout: { autoLayout: true, flexDirection: 'column', gap: 0 },
      children: [
        textNode('a', 10, 20),
        { ...textNode('b', 10, 999), absolutePosition: true },
        { ...textNode('c', 10, 999), visible: false },
      ],
    })
    normalizeFitContentSizes([f])
    expect(f.height).toBe(20)
  })

  it('sizes nested hug frames bottom-up', () => {
    const inner = frame({
      id: 'inner',
      width: 0,
      height: 0,
      sizing: { heightMode: 'fit_content' },
      layout: { autoLayout: true, flexDirection: 'column', gap: 0 },
      children: [textNode('x', 10, 40), textNode('y', 10, 40)],
    })
    const outer = frame({
      id: 'outer',
      width: 0,
      height: 0,
      sizing: { heightMode: 'fit_content' },
      layout: { autoLayout: true, flexDirection: 'column', gap: 0 },
      children: [inner],
    })
    normalizeFitContentSizes([outer])
    expect(inner.height).toBe(80)
    expect(outer.height).toBe(80) // inner's corrected 80 propagates up
  })

  it('skips wrapping frames (single-line formula would under-count)', () => {
    const f = frame({
      id: 'f',
      width: 0,
      height: 30,
      sizing: { heightMode: 'fit_content' },
      layout: { autoLayout: true, flexDirection: 'row', flexWrap: true, gap: 0 },
      children: [textNode('a', 100, 20), textNode('b', 100, 20)],
    })
    normalizeFitContentSizes([f])
    expect(f.height).toBe(30) // untouched
  })
})
