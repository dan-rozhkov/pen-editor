import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import { decodePixsoDataFic } from '../decode'
import { extractPixsoDataFic } from '../extract'
import { pixsoMessageToFigPasteData } from '../adapt'

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
})
