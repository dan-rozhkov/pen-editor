import { describe, expect, it } from 'vitest'

import type { FlatSceneNode, GradientFill, Paint } from '@/types/scene'
import {
  clearLegacyEffectProps,
  clearLegacyFillProps,
  clearLegacyStrokeProps,
  createBlurEffect,
  createBackgroundBlurEffect,
  createImagePaint,
  createNoiseEffect,
  createShadowEffect,
  createSolidPaint,
  getEffects,
  getFills,
  getPrimarySolidColor,
  getPrimarySolidPaint,
  getRenderableFills,
  getRenderableStrokes,
  getStrokes,
  legacyFillsToPaints,
  legacyStrokesToPaints,
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

  it('clears every legacy stroke field (color only, geometry untouched)', () => {
    expect(clearLegacyStrokeProps()).toEqual({
      stroke: undefined,
      strokeOpacity: undefined,
      strokeBinding: undefined,
    })
  })
})

describe('getStrokes', () => {
  it('returns strokes verbatim when set, ignoring legacy fields', () => {
    const strokes: Paint[] = [createSolidPaint('#ff0000')]
    const node = makeNode({ strokes, stroke: '#00ff00' })
    expect(getStrokes(node)).toBe(strokes)
  })

  it('derives a solid paint from legacy stroke with opacity and binding', () => {
    const node = makeNode({ stroke: '#336699', strokeOpacity: 0.5, strokeBinding: { variableId: 'v1' } })
    const strokes = getStrokes(node)
    expect(strokes).toHaveLength(1)
    expect(strokes[0]).toMatchObject({
      type: 'solid',
      color: '#336699',
      opacity: 0.5,
      colorBinding: { variableId: 'v1' },
    })
  })

  it('falls back to PathStroke.fill when stroke/strokeWidth are unset (path nodes)', () => {
    const node = makeNode({ type: 'path', pathStroke: { fill: '#123456', thickness: 3, align: 'inside' } } as Partial<FlatSceneNode>)
    const strokes = getStrokes(node)
    expect(strokes).toHaveLength(1)
    expect(strokes[0]).toMatchObject({ type: 'solid', color: '#123456' })
  })

  it('prefers node.stroke over PathStroke.fill when both are present', () => {
    const node = makeNode({
      type: 'path',
      stroke: '#ff0000',
      pathStroke: { fill: '#123456' },
    } as Partial<FlatSceneNode>)
    expect(getStrokes(node)[0]).toMatchObject({ color: '#ff0000' })
  })

  it('returns empty stack when node has no stroke at all', () => {
    expect(getStrokes(makeNode({}))).toEqual([])
  })

  it('getStrokes caches the derived legacy stack per node object', () => {
    const node = makeNode({ stroke: '#123456' })
    expect(getStrokes(node)).toBe(getStrokes(node))
  })
})

describe('getRenderableStrokes', () => {
  it('filters hidden and zero-opacity paints', () => {
    const node = makeNode({
      strokes: [
        createSolidPaint('#111111', { visible: false }),
        createSolidPaint('#222222', { opacity: 0 }),
        createSolidPaint('#333333'),
      ],
    })
    const renderable = getRenderableStrokes(node)
    expect(renderable).toHaveLength(1)
    expect((renderable[0] as { color: string }).color).toBe('#333333')
  })
})

describe('legacyStrokesToPaints', () => {
  it('produces deterministic paint ids (stable React keys)', () => {
    const node = makeNode({ stroke: '#123456' })
    const a = legacyStrokesToPaints(node)
    const b = legacyStrokesToPaints(node)
    expect(a[0].id).toBe(b[0].id)
  })
})

describe('createBlurEffect', () => {
  it('defaults to radius 4 with a fresh id', () => {
    const a = createBlurEffect()
    const b = createBlurEffect()
    expect(a).toMatchObject({ type: 'blur', radius: 4 })
    expect(a.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  it('accepts overrides', () => {
    expect(createBlurEffect({ radius: 12, visible: false })).toMatchObject({
      type: 'blur',
      radius: 12,
      visible: false,
    })
  })
})

describe('createBackgroundBlurEffect', () => {
  it('defaults to radius 4 with a fresh id', () => {
    const a = createBackgroundBlurEffect()
    const b = createBackgroundBlurEffect()
    expect(a).toMatchObject({ type: 'background-blur', radius: 4 })
    expect(a.id).toBeTruthy()
    expect(a.id).not.toBe(b.id)
  })

  it('accepts overrides', () => {
    expect(createBackgroundBlurEffect({ radius: 12, visible: false })).toMatchObject({
      type: 'background-blur',
      radius: 12,
      visible: false,
    })
  })
})

describe('createNoiseEffect', () => {
  it('creates a mono noise effect with defaults and an id', () => {
    const e = createNoiseEffect()
    expect(e.type).toBe('noise')
    expect(e.noiseType).toBe('mono')
    expect(e.color).toBe('#00000080')
    expect(e.noiseSize).toBe(1)
    expect(e.density).toBe(0.5)
    expect(e.id).toBeTruthy()
  })
  it('accepts overrides', () => {
    const e = createNoiseEffect({ noiseType: 'duo', secondaryColor: '#ffffffff', density: 0.2 })
    expect(e.noiseType).toBe('duo')
    expect(e.secondaryColor).toBe('#ffffffff')
    expect(e.density).toBe(0.2)
  })
})
