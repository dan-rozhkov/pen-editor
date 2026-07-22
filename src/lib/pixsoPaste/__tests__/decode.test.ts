import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import textHtml from './fixtures/text.html?raw'
import { decodePixsoDataFic } from '../decode'
import { extractPixsoDataFic } from '../extract'

describe('decodePixsoDataFic', () => {
  it('decodes the rect payload', async () => {
    const msg = await decodePixsoDataFic(extractPixsoDataFic(rectHtml)!)
    const rect = (msg.pixsoNodes ?? []).find((n) => (n as { type?: string }).type === 'RECTANGLE')
    expect(rect).toBeTruthy()
    expect((rect as { size?: { x: number; y: number } }).size).toEqual({ x: 200, y: 100 })
  })
  it('decodes the text payload characters', async () => {
    const msg = await decodePixsoDataFic(extractPixsoDataFic(textHtml)!)
    const text = (msg.pixsoNodes ?? []).find((n) => (n as { type?: string }).type === 'TEXT') as {
      textData?: { characters?: string }
    }
    expect(text?.textData?.characters?.startsWith('Карточка товара')).toBe(true)
  })
})
