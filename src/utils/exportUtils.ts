import { Rectangle, type Container as PixiContainer } from 'pixi.js'
import type { PixiExportRefs } from '@/store/canvasRefStore'
import { getExportSettingMimeType, sanitizeExportBaseName } from '@/utils/exportSettingsUtils'
import { useSceneStore } from '@/store/sceneStore'
import { useLayoutStore } from '@/store/layoutStore'
import { getNodeEffectiveSize } from '@/utils/nodeUtils'

/**
 * Download a data URL as a file
 */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a')
  link.href = dataUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

function hidePixiOverlays(pixiRefs: PixiExportRefs): () => void {
  const prevOverlayVisible = pixiRefs.overlayContainer.visible
  const prevSelectionVisible = pixiRefs.selectionContainer.visible
  pixiRefs.overlayContainer.visible = false
  pixiRefs.selectionContainer.visible = false

  return () => {
    pixiRefs.overlayContainer.visible = prevOverlayVisible
    pixiRefs.selectionContainer.visible = prevSelectionVisible
  }
}

/**
 * A node's declared export size (design px) — the same "effective size" used
 * for PDF page sizing (`getNodeEffectiveSize`, also used by
 * `exportPdfUtils.getFrameDescriptor`): the Yoga-resolved size for auto-layout
 * children and fit_content frames, falling back to the raw stored width/height.
 */
export function getNodeExportSize(nodeId: string): { width: number; height: number } {
  const { getNodes, nodesById } = useSceneStore.getState()
  const { calculateLayoutForFrame } = useLayoutStore.getState()
  const node = nodesById[nodeId]
  const size = getNodeEffectiveSize(getNodes(), nodeId, calculateLayoutForFrame)
  return size ?? { width: node?.width ?? 0, height: node?.height ?? 0 }
}

/**
 * Build an explicit Pixi `extract.canvas({ frame })` region from a node's
 * declared width/height, or `undefined` when degenerate (falls back to Pixi's
 * implicit content-bounds region).
 *
 * Without an explicit `frame`, Pixi's extract falls back to
 * `getLocalBounds(target)` — the tight bounding box of the target's *rendered*
 * content, not its declared size. For a frame with no full-covering background
 * fill (a plain grouping/auto-layout frame, or one with padding/gaps around
 * its children), that bounding box can be smaller than the frame's own
 * width/height, so the exported PNG comes out smaller ("downscaled") than the
 * expected width×height — independent of scale or devicePixelRatio. Pinning
 * an explicit `frame` here makes the output size deterministic: exactly the
 * node's declared width×height, times `scale` (see `computeExportSize`).
 *
 * (`resolution: scale`, passed alongside this at each call site, is NOT the
 * cause: Pixi v8's `GenerateTextureSystem.generateTexture` uses
 * `options.resolution` verbatim — it does not combine it with
 * `renderer.resolution` — and `RenderTargetSystem.bind`/`Gl|Gpu|CanvasTextureSystem`
 * size the GL viewport and output canvas from the extracted RenderTexture's
 * own pixel size, never from the app renderer's resolution/devicePixelRatio.
 * So `resolution: scale` alone already yields scale-correct pixels regardless
 * of monitor DPR.)
 */
export function toExtractFrame(width: number, height: number): Rectangle | undefined {
  if (!(width > 0) || !(height > 0)) return undefined
  return new Rectangle(0, 0, width, height)
}

export function findContainerByLabel(
  root: PixiContainer,
  label: string,
): PixiContainer | null {
  if (root.label === label) return root

  for (const child of root.children) {
    const container = child as PixiContainer
    if (container.label === label) return container
    const found = findContainerByLabel(container, label)
    if (found) return found
  }

  return null
}

/**
 * A frame (or any node) to render onto one export page/image. Format-neutral —
 * shared by the PDF, PPTX, and images-ZIP page-level exporters.
 */
export interface PdfFrameDescriptor {
  id: string
  name?: string
  /** Logical (unscaled) width/height in design px, used as the page/image size (1px = 1pt for PDF). */
  width: number
  height: number
}

/** Resolve a single frame's effective export page size, falling back to stored width/height. */
export function getFrameDescriptor(nodeId: string, name: string | undefined): PdfFrameDescriptor {
  const { getNodes, nodesById } = useSceneStore.getState()
  const { calculateLayoutForFrame } = useLayoutStore.getState()
  const nodes = getNodes()
  const node = nodesById[nodeId]
  const size = getNodeEffectiveSize(nodes, nodeId, calculateLayoutForFrame) ?? {
    width: node?.width ?? 0,
    height: node?.height ?? 0,
  }
  return { id: nodeId, name, width: size.width, height: size.height }
}

/** Top-level `frame` nodes on the current page, in Layers-panel top-to-bottom (page) order. */
export function getTopLevelFrames(): PdfFrameDescriptor[] {
  const { rootIds, nodesById } = useSceneStore.getState()

  const frames: PdfFrameDescriptor[] = []
  for (const id of [...rootIds].reverse()) {
    const node = nodesById[id]
    if (!node || node.type !== 'frame') continue
    frames.push(getFrameDescriptor(id, node.name))
  }
  return frames
}

/**
 * Viewport culling (`syncAutoLayout.ts` `updateCulling`) sets `container.renderable
 * = false` on root frame containers outside the viewport, which would make
 * `renderer.extract.canvas` rasterize a blank page for any frame not currently
 * on-screen. Force `container` and its ancestors (up to and including
 * `sceneRoot`) renderable for the duration of `fn`, then restore whatever they
 * were before.
 */
export function withForcedRenderable<T>(container: PixiContainer, sceneRoot: PixiContainer, fn: () => T): T {
  const restore: Array<() => void> = []
  let current: PixiContainer | null = container
  while (current) {
    if (!current.renderable) {
      const target = current
      restore.push(() => {
        target.renderable = false
      })
      current.renderable = true
    }
    if (current === sceneRoot) break
    current = current.parent as PixiContainer | null
  }
  try {
    return fn()
  } finally {
    for (const undo of restore) undo()
  }
}

/**
 * Resolve the shared base filename (no extension) for a page-level "export
 * all frames" archive/document: the sanitized single frame's name/id when
 * there is exactly one frame, otherwise the fixed "canvas" fallback used for
 * multi-frame output. Shared by the PDF (`resolvePdfDownloadFilename`) and
 * images-ZIP page exporters so a single-frame page named e.g. "Cover" yields
 * a consistently named "Cover.pdf"/"Cover.zip" instead of diverging.
 */
export function resolvePageExportBaseName(frames: PdfFrameDescriptor[]): string {
  const base = frames.length === 1 ? frames[0].name || frames[0].id : 'canvas'
  return sanitizeExportBaseName(base)
}

export function downloadBlob(bytes: Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([bytes as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  try {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

/** Raster formats + arbitrary scale, as used by per-node export settings (`exportSettingsUtils`). */
export type RasterExportFormat = 'png' | 'jpg' | 'webp'

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * Extract a Pixi container's live pixels as raw image bytes (not a data URL)
 * at a given format/scale — the bytes-returning cousin of
 * `exportImageFromPixiWithFilename`, which downloads a data URL directly
 * instead of handing bytes back to the caller. Shared by every exporter that
 * needs to assemble rasterized frames into a bigger artifact before
 * downloading it (PDF pages in `exportPdfUtils.ts`, PPTX media in
 * `exportPptxUtils.ts`, ZIP entries in `exportImagesZipUtils.ts`) — previously
 * each had its own near-identical copy of this extract+decode logic.
 *
 * Pins an explicit `frame` from the caller-supplied `size` (see
 * `toExtractFrame`) so the rasterized output is exactly `width×height×scale`
 * px, instead of Pixi's implicit content-bounds region (which can come out
 * smaller than the frame for content with no full-covering background).
 */
/**
 * JPEG has no alpha channel. The Pixi app runs with `backgroundAlpha: 0`, so
 * `extract.canvas` yields alpha=0 pixels wherever a frame has no full-covering
 * fill, and `canvas.toDataURL('image/jpeg', q)` composites transparency onto
 * BLACK (the browser's default), not the visually-expected white/blank
 * background. Flatten onto an opaque white canvas first so JPEG export of a
 * frame without a full-covering fill doesn't come out with black regions.
 */
function flattenOntoWhite(source: HTMLCanvasElement): HTMLCanvasElement {
  const flattened = document.createElement('canvas')
  flattened.width = source.width
  flattened.height = source.height
  const ctx = flattened.getContext('2d')
  if (!ctx) return source
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, flattened.width, flattened.height)
  ctx.drawImage(source, 0, 0)
  return flattened
}

export function extractImageBytes(
  pixiRefs: PixiExportRefs,
  container: PixiContainer,
  scale: number,
  size: { width: number; height: number },
  mimeType: string,
  quality?: number,
): Uint8Array {
  const canvas = pixiRefs.app.renderer.extract.canvas({
    target: container,
    resolution: scale,
    antialias: true,
    frame: toExtractFrame(size.width, size.height),
  }) as HTMLCanvasElement
  const output = mimeType === 'image/jpeg' ? flattenOntoWhite(canvas) : canvas
  const dataUrl = output.toDataURL(mimeType, quality)
  return dataUrlToUint8Array(dataUrl)
}

/**
 * Like `exportImageFromPixi`, but takes an arbitrary numeric `scale` (export
 * settings allow 0.5x/1.5x/custom, not just the fixed 1/2/3 the toolbar
 * export uses) and an explicit `filename` (export settings compute their own
 * filename with suffix — see `buildExportFilename`), and supports webp.
 */
export function exportImageFromPixiWithFilename(
  pixiRefs: PixiExportRefs,
  nodeId: string | null,
  format: RasterExportFormat,
  scale: number,
  filename: string,
  quality?: number,
): boolean {
  try {
    const mimeType = getExportSettingMimeType(format)
    const encoderQuality = quality ?? (format === 'png' ? undefined : 0.92)

    if (nodeId) {
      const targetNode = findContainerByLabel(pixiRefs.sceneRoot, nodeId)
      if (!targetNode) return false
      const { width, height } = getNodeExportSize(nodeId)
      const extracted = pixiRefs.app.renderer.extract.canvas({
        target: targetNode,
        resolution: scale,
        antialias: true,
        frame: toExtractFrame(width, height),
      }) as HTMLCanvasElement
      const dataUrl = extracted.toDataURL(mimeType, encoderQuality)
      downloadDataUrl(dataUrl, filename)
      return true
    }

    const restoreOverlays = hidePixiOverlays(pixiRefs)
    try {
      const extracted = pixiRefs.app.renderer.extract.canvas({
        target: pixiRefs.sceneRoot,
        resolution: scale,
        antialias: true,
      }) as HTMLCanvasElement
      const dataUrl = extracted.toDataURL(mimeType, encoderQuality)
      downloadDataUrl(dataUrl, filename)
      return true
    } finally {
      restoreOverlays()
      pixiRefs.app.renderer.render(pixiRefs.app.stage)
    }
  } catch (error) {
    console.error('Failed to export Pixi canvas:', error)
    return false
  }
}
