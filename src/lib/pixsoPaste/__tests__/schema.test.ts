import { describe, it, expect } from 'vitest'
import rectHtml from './fixtures/rect.html?raw'
import { decodePixsoMsg } from '../schema'

function dataFic(html: string): string {
  return html.match(/data-fic="([^"]+)"/)![1]
}

describe('pixso schema', () => {
  it('compiles and decodes the rect payload to a RECTANGLE', async () => {
    const { decompressPixsoDataFic } = await import('../decode')
    const b64 = dataFic(rectHtml)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const decompressed = decompressPixsoDataFic(bytes)
    const msg = await decodePixsoMsg(decompressed)
    expect(msg.type).toBe('NODE_CHANGES')
    const rect = (msg.pixsoNodes ?? []).find((n) => (n as { type?: string }).type === 'RECTANGLE') as {
      size?: { x: number; y: number }
      fillPaints?: { color?: { r: number } }[]
    }
    expect(rect?.size).toEqual({ x: 200, y: 100 })
    expect(rect?.fillPaints?.[0]?.color?.r).toBe(255)
  })
})
