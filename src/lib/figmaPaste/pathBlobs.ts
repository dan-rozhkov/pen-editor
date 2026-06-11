// Decoding of Figma geometry blobs.
//
// "commands" format — a byte stream of drawing commands:
//   0 = Z (close path)
//   1 = M x y       (move to)
//   2 = L x y       (line to)
//   3 = Q cx cy x y (quadratic bezier)
//   4 = C c1x c1y c2x c2y x y (cubic bezier)
// All coordinates are little-endian float32, in node-local pixels.
//
// "vectorNetwork" format — the raw editing topology of VECTOR nodes
// (clipboard payloads carry this instead of derived command geometry):
//   u32 vertexCount, u32 segmentCount, u32 regionCount
//   vertices: { u32 styleID, f32 x, f32 y }
//   segments: { u32 styleID, u32 startVertex, f32 t1x, f32 t1y,
//               u32 endVertex, f32 t2x, f32 t2y }   (tangents are relative)
//   regions:  { u32 flags (bit0 = NONZERO, rest styleID), u32 loopCount,
//               loops: { u32 indexCount, u32 segmentIndex[] } }
// Coordinates are in vectorData.normalizedSize space and must be scaled to
// the node size.

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

// ---------------------------------------------------------------------------
// Vector networks
// ---------------------------------------------------------------------------

interface NetworkVertex {
  x: number
  y: number
}

interface NetworkSegment {
  start: number
  end: number
  // Tangent handles relative to the corresponding vertex
  t1x: number
  t1y: number
  t2x: number
  t2y: number
}

interface NetworkRegion {
  windingRule: 'NONZERO' | 'ODD'
  loops: number[][]
}

export interface VectorNetwork {
  vertices: NetworkVertex[]
  segments: NetworkSegment[]
  regions: NetworkRegion[]
}

/** Decode a Figma vector-network blob. Returns null on malformed data. */
export function decodeVectorNetworkBlob(bytes: Uint8Array): VectorNetwork | null {
  if (bytes.length < 12) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const vertexCount = view.getUint32(0, true)
  const segmentCount = view.getUint32(4, true)
  const regionCount = view.getUint32(8, true)
  let offset = 12

  const vertices: NetworkVertex[] = []
  for (let i = 0; i < vertexCount; i++) {
    if (offset + 12 > bytes.length) return null
    vertices.push({
      x: view.getFloat32(offset + 4, true),
      y: view.getFloat32(offset + 8, true),
    })
    offset += 12
  }

  const segments: NetworkSegment[] = []
  for (let i = 0; i < segmentCount; i++) {
    if (offset + 28 > bytes.length) return null
    const start = view.getUint32(offset + 4, true)
    const end = view.getUint32(offset + 16, true)
    if (start >= vertexCount || end >= vertexCount) return null
    segments.push({
      start,
      t1x: view.getFloat32(offset + 8, true),
      t1y: view.getFloat32(offset + 12, true),
      end,
      t2x: view.getFloat32(offset + 20, true),
      t2y: view.getFloat32(offset + 24, true),
    })
    offset += 28
  }

  const regions: NetworkRegion[] = []
  for (let i = 0; i < regionCount; i++) {
    if (offset + 8 > bytes.length) return null
    const flags = view.getUint32(offset, true)
    const loopCount = view.getUint32(offset + 4, true)
    offset += 8
    const loops: number[][] = []
    for (let j = 0; j < loopCount; j++) {
      if (offset + 4 > bytes.length) return null
      const indexCount = view.getUint32(offset, true)
      offset += 4
      if (offset + indexCount * 4 > bytes.length) return null
      const indices: number[] = []
      for (let k = 0; k < indexCount; k++) {
        const segment = view.getUint32(offset, true)
        if (segment >= segmentCount) return null
        indices.push(segment)
        offset += 4
      }
      loops.push(indices)
    }
    regions.push({ windingRule: flags & 1 ? 'NONZERO' : 'ODD', loops })
  }

  return { vertices, segments, regions }
}

interface OrientedSegment {
  from: NetworkVertex
  to: NetworkVertex
  // Absolute control points
  c1x: number
  c1y: number
  c2x: number
  c2y: number
  isLine: boolean
}

function orientSegment(
  network: VectorNetwork,
  index: number,
  reversed: boolean,
  sx: number,
  sy: number,
): OrientedSegment {
  const seg = network.segments[index]
  const a = network.vertices[seg.start]
  const b = network.vertices[seg.end]
  const from = reversed ? b : a
  const to = reversed ? a : b
  const fromT = reversed ? { x: seg.t2x, y: seg.t2y } : { x: seg.t1x, y: seg.t1y }
  const toT = reversed ? { x: seg.t1x, y: seg.t1y } : { x: seg.t2x, y: seg.t2y }
  return {
    from: { x: from.x * sx, y: from.y * sy },
    to: { x: to.x * sx, y: to.y * sy },
    c1x: (from.x + fromT.x) * sx,
    c1y: (from.y + fromT.y) * sy,
    c2x: (to.x + toT.x) * sx,
    c2y: (to.y + toT.y) * sy,
    isLine: fromT.x === 0 && fromT.y === 0 && toT.x === 0 && toT.y === 0,
  }
}

function samePoint(a: NetworkVertex, b: NetworkVertex): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6
}

function emitSegment(parts: string[], seg: OrientedSegment, isFirst: boolean): void {
  if (isFirst) parts.push(`M ${fmt(seg.from.x)} ${fmt(seg.from.y)}`)
  if (seg.isLine) {
    parts.push(`L ${fmt(seg.to.x)} ${fmt(seg.to.y)}`)
  } else {
    parts.push(
      `C ${fmt(seg.c1x)} ${fmt(seg.c1y)} ${fmt(seg.c2x)} ${fmt(seg.c2y)} ${fmt(seg.to.x)} ${fmt(seg.to.y)}`,
    )
  }
}

/**
 * Chain a list of segment indices into one subpath, flipping segments whose
 * stored direction does not continue from the previous endpoint.
 */
function chainSegments(
  network: VectorNetwork,
  indices: number[],
  sx: number,
  sy: number,
  close: boolean,
): string[] {
  const parts: string[] = []
  let current: NetworkVertex | null = null

  for (let i = 0; i < indices.length; i++) {
    const seg = network.segments[indices[i]]
    let reversed = false
    if (current) {
      const startV = network.vertices[seg.start]
      const endV = network.vertices[seg.end]
      if (!samePoint(startV, current) && samePoint(endV, current)) reversed = true
      // Discontinuity: start a new subpath from this segment
      if (!samePoint(startV, current) && !samePoint(endV, current)) current = null
    } else if (indices.length > 1) {
      // Orient the first segment so that it connects to the second one
      const next = network.segments[indices[(i + 1) % indices.length]]
      const endV = network.vertices[seg.end]
      const startV = network.vertices[seg.start]
      const nextTouches = (v: NetworkVertex) =>
        samePoint(v, network.vertices[next.start]) || samePoint(v, network.vertices[next.end])
      if (!nextTouches(endV) && nextTouches(startV)) reversed = true
    }

    const oriented = orientSegment(network, indices[i], reversed, sx, sy)
    emitSegment(parts, oriented, current === null)
    current = reversed ? network.vertices[seg.start] : network.vertices[seg.end]
  }

  if (close && parts.length > 0) parts.push('Z')
  return parts
}

/**
 * Build SVG path data from a vector network, scaled from normalizedSize space
 * to node-size space. Filled regions become closed subpaths; when the network
 * has no regions the segments form an open path (stroke-only vectors).
 */
export function vectorNetworkToPathData(
  network: VectorNetwork,
  scaleX: number,
  scaleY: number,
): { d: string; windingRule: 'NONZERO' | 'ODD' } | null {
  const parts: string[] = []

  if (network.regions.length > 0) {
    for (const region of network.regions) {
      for (const loop of region.loops) {
        parts.push(...chainSegments(network, loop, scaleX, scaleY, true))
      }
    }
  } else {
    parts.push(...chainSegments(network, network.segments.map((_, i) => i), scaleX, scaleY, false))
  }

  if (parts.length === 0) return null
  return {
    d: parts.join(' '),
    windingRule: network.regions.some((r) => r.windingRule === 'ODD') ? 'ODD' : 'NONZERO',
  }
}
