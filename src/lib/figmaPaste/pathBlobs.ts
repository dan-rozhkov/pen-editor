// Decoding of Figma geometry blobs ("commands" format).
//
// A path blob is a byte stream of drawing commands:
//   0 = Z (close path)
//   1 = M x y       (move to)
//   2 = L x y       (line to)
//   3 = Q cx cy x y (quadratic bezier)
//   4 = C c1x c1y c2x c2y x y (cubic bezier)
// All coordinates are little-endian float32, in node-local pixels.

const COORD_PRECISION = 4

function fmt(n: number): string {
  // Trim float32 noise (e.g. 12.000000476837158 → 12)
  return String(Number(n.toFixed(COORD_PRECISION)))
}

/** Decode a Figma path-commands blob into an SVG path `d` string. */
export function decodePathCommandsBlob(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const parts: string[] = []
  let offset = 0

  const readFloats = (count: number): number[] | null => {
    if (offset + count * 4 > bytes.length) return null
    const values: number[] = []
    for (let i = 0; i < count; i++) {
      values.push(view.getFloat32(offset, true))
      offset += 4
    }
    return values
  }

  while (offset < bytes.length) {
    const command = bytes[offset++]
    switch (command) {
      case 0:
        parts.push('Z')
        break
      case 1: {
        const v = readFloats(2)
        if (!v) return parts.join(' ')
        parts.push(`M ${fmt(v[0])} ${fmt(v[1])}`)
        break
      }
      case 2: {
        const v = readFloats(2)
        if (!v) return parts.join(' ')
        parts.push(`L ${fmt(v[0])} ${fmt(v[1])}`)
        break
      }
      case 3: {
        const v = readFloats(4)
        if (!v) return parts.join(' ')
        parts.push(`Q ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])} ${fmt(v[3])}`)
        break
      }
      case 4: {
        const v = readFloats(6)
        if (!v) return parts.join(' ')
        parts.push(`C ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])} ${fmt(v[3])} ${fmt(v[4])} ${fmt(v[5])}`)
        break
      }
      default:
        // Unknown command byte — stop decoding to avoid garbage output
        return parts.join(' ')
    }
  }

  return parts.join(' ')
}
