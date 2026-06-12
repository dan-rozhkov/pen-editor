import { describe, expect, it } from 'vitest'

import type { FlatSceneNode, GradientFill, Paint } from '@/types/scene'
import {
  clearLegacyEffectProps,
  clearLegacyFillProps,
  createImagePaint,
  createShadowEffect,
  createSolidPaint,
  getEffects,
  getFills,
  getPrimarySolidColor,
  getPrimarySolidPaint,
  getRenderableFills,
  legacyFillsToPaints,
} from '@/utils/fillUtils'

function makeNode(props: Partial<FlatSceneNode>): FlatSceneNode {
  return { id: 'n1', type: 'rect', x: 0, y: 0, width: 10, height: 10, ...props } as FlatSceneNode
}

const gradient: GradientFill = {
  type: 'linear',
  stops: [
    { color: '#000000', position: 0 },
    { color: '#ffffff', position: 1 },
  ],
  startX: 0,
  startY: 0,
  endX: 1,
  endY: 1,
}

describe('getFills', () => {
  it('returns fills verbatim when set, ignoring legacy fields', () => {
    const fills: Paint[] = [createSolidPaint('#ff0000')]
    const node = makeNode({ fills, fill: '#00ff00', gradientFill: gradient })
    expect(getFills(node)).toBe(fills)
  })

  it('derives a solid paint from legacy fill with opacity and binding', () => {
    const node = makeNode({ fill: '#336699', fillOpacity: 0.5, fillBinding: { variableId: 'v1' } })
    const fills = getFills(node)
    expect(fills).toHaveLength(1)
    expect(fills[0]).toMatchObject({
      type: 'solid',
      color: '#336699',
      opacity: 0.5,
      colorBinding: { variableId: 'v1' },
    })
  })

  it('prefers legacy gradient over solid and stacks image on top', () => {
    const node = makeNode({
      fill: '#336699',
      gradientFill: gradient,
      imageFill: { url: 'https://x/y.png', mode: 'fill' },
    })
    const fills = getFills(node)
    expect(fills.map((p) => p.type)).toEqual(['gradient', 'image'])
  })

  it('returns empty stack when node has no fill at all', () => {
    expect(getFills(makeNode({}))).toEqual([])
  })
})

describe('renderable helpers', () => {
  it('filters hidden and zero-opacity paints', () => {
    const node = makeNode({
      fills: [
        createSolidPaint('#111111', { visible: false }),
        createSolidPaint('#222222', { opacity: 0 }),
        createSolidPaint('#333333'),
      ],
    })
    const renderable = getRenderableFills(node)
    expect(renderable).toHaveLength(1)
    expect((renderable[0] as { color: string }).color).toBe('#333333')
  })
})

describe('getPrimarySolidColor', () => {
  it('returns the topmost visible solid color', () => {
    const node = makeNode({
      fills: [
        createSolidPaint('#bottom'),
        createSolidPaint('#top'),
        createSolidPaint('#hidden', { visible: false }),
        createImagePaint({ url: 'u', mode: 'fill' }),
      ],
    })
    expect(getPrimarySolidColor(node)).toBe('#top')
  })

  it('falls back to legacy fill', () => {
    expect(getPrimarySolidColor(makeNode({ fill: '#abc123' }))).toBe('#abc123')
  })

  it('getPrimarySolidPaint returns the paint itself', () => {
    const node = makeNode({ fills: [createSolidPaint('#abc123', { opacity: 0.5 })] })
    expect(getPrimarySolidPaint(node)).toMatchObject({ color: '#abc123', opacity: 0.5 })
  })
})

describe('legacyFillsToPaints', () => {
  it('produces deterministic paint ids (stable React keys)', () => {
    const node = makeNode({ fill: '#123456' })
    const a = legacyFillsToPaints(node)
    const b = legacyFillsToPaints(node)
    expect(a[0].id).toBe(b[0].id)
  })

  it('getFills caches the derived stack per node object', () => {
    const node = makeNode({ fill: '#123456' })
    expect(getFills(node)).toBe(getFills(node))
  })
})

describe('effects', () => {
  it('reads effects array verbatim and falls back to legacy effect', () => {
    const shadow = createShadowEffect()
    expect(getEffects(makeNode({ effects: [shadow] }))).toEqual([shadow])
    const legacy = makeNode({
      effect: { type: 'shadow', shadowType: 'outer', color: '#00000040', offset: { x: 0, y: 1 }, blur: 2, spread: 0 },
    })
    expect(getEffects(legacy)).toHaveLength(1)
    expect(getEffects(makeNode({}))).toEqual([])
  })
})

describe('clear helpers', () => {
  it('clears every legacy fill/effect field', () => {
    expect(clearLegacyFillProps()).toEqual({
      fill: undefined,
      fillOpacity: undefined,
      fillBinding: undefined,
      gradientFill: undefined,
      imageFill: undefined,
    })
    expect(clearLegacyEffectProps()).toEqual({ effect: undefined })
  })
})
