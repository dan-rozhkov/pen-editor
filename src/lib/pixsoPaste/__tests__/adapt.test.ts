import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import { decodePixsoDataFic } from '../decode'
import { extractPixsoDataFic } from '../extract'
import { pixsoMessageToFigPasteData } from '../adapt'
import type { PixsoMessage } from '../schema'

async function fig(html: string) {
  return pixsoMessageToFigPasteData(await decodePixsoDataFic(extractPixsoDataFic(html)!))
}

describe('pixsoMessageToFigPasteData', () => {
  it('renames pixsoNodes to nodeChanges and scales colors to 0..1', async () => {
    const data = await fig(rectHtml)
    const changes = data.message.nodeChanges ?? []
    const rect = changes.find((c) => c.type === 'RECTANGLE')!
    const color = rect.fillPaints![0].color!
    expect(color.r).toBeCloseTo(1, 5)
    expect(color.g).toBeCloseTo(0, 5)
    expect(color.b).toBeCloseTo(0, 5)
    expect(color.a).toBeCloseTo(1, 5)
  })

  describe('auto-layout field remap', () => {
    function synthetic(pixsoNodes: Record<string, unknown>[]) {
      const msg: PixsoMessage = { type: 'NODE_CHANGES', pixsoNodes }
      return pixsoMessageToFigPasteData(msg)
    }

    it('maps autoLayoutAbsolutePos true to stackPositioning ABSOLUTE', () => {
      const data = synthetic([{ type: 'FRAME', autoLayoutAbsolutePos: true }])
      expect(data.message.nodeChanges![0].stackPositioning).toBe('ABSOLUTE')
    })

    it('does not set stackPositioning when autoLayoutAbsolutePos is false', () => {
      const data = synthetic([{ type: 'FRAME', autoLayoutAbsolutePos: false }])
      expect(data.message.nodeChanges![0].stackPositioning).toBeUndefined()
    })

    it('does NOT map stackChildPrimarySizing to grow (primary RESIZE_TO_FIT is hug, not fill)', () => {
      const data = synthetic([{ type: 'FRAME', stackChildPrimarySizing: 'RESIZE_TO_FIT' }])
      expect(data.message.nodeChanges![0].stackChildPrimaryGrow).toBeUndefined()
    })

    it('maps stackChildCounterSizing RESIZE_TO_FIT to stackChildAlignSelf STRETCH', () => {
      const data = synthetic([{ type: 'FRAME', stackChildCounterSizing: 'RESIZE_TO_FIT' }])
      expect(data.message.nodeChanges![0].stackChildAlignSelf).toBe('STRETCH')
    })

    it('does not set stackChildAlignSelf for a FIXED counter sizing', () => {
      const data = synthetic([{ type: 'FRAME', stackChildCounterSizing: 'FIXED' }])
      expect(data.message.nodeChanges![0].stackChildAlignSelf).toBeUndefined()
    })

    it('maps stackPaddingTop/stackPaddingLeft to stackVerticalPadding/stackHorizontalPadding', () => {
      const data = synthetic([{ type: 'FRAME', stackPaddingTop: 12, stackPaddingLeft: 8 }])
      const change = data.message.nodeChanges![0]
      expect(change.stackVerticalPadding).toBe(12)
      expect(change.stackHorizontalPadding).toBe(8)
    })

    it('does not clobber a Figma field already set to a meaningful value', () => {
      const data = synthetic([
        { type: 'FRAME', autoLayoutAbsolutePos: true, stackPositioning: 'AUTO' },
      ])
      expect(data.message.nodeChanges![0].stackPositioning).toBe('AUTO')
    })

    it('remaps fields nested in derivedSymbolData entries', () => {
      const data = synthetic([
        {
          type: 'INSTANCE',
          derivedSymbolData: [{ autoLayoutAbsolutePos: true, stackPaddingTop: 4 }],
        },
      ])
      const derived = data.message.nodeChanges![0].derivedSymbolData![0]
      expect(derived.stackPositioning).toBe('ABSOLUTE')
      expect(derived.stackVerticalPadding).toBe(4)
    })

    it('remaps fields nested in symbolData.symbolOverrides entries', () => {
      const data = synthetic([
        {
          type: 'INSTANCE',
          symbolData: {
            symbolOverrides: [{ stackChildCounterSizing: 'RESIZE_TO_FIT', stackPaddingLeft: 6 }],
          },
        },
      ])
      const override = data.message.nodeChanges![0].symbolData!.symbolOverrides![0]
      expect(override.stackChildAlignSelf).toBe('STRETCH')
      expect(override.stackHorizontalPadding).toBe(6)
    })
  })
})
