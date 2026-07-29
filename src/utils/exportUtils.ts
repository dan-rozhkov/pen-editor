import { Rectangle, type Container as PixiContainer } from 'pixi.js'
import type { PixiExportRefs } from '@/store/canvasRefStore'
import { getExportSettingMimeType, sanitizeExportBaseName } from '@/utils/exportSettingsUtils'
import { useSceneStore } from '@/store/sceneStore'
import { useLayoutStore } from '@/store/layoutStore'
import { getNodeEffectiveSize } from '@/utils/nodeUtils'
import { captureEmbedCanvas } from '@/lib/embedScreenshot'
import { resolveRefToTree } from '@/utils/instanceRuntime'
import type { EmbedNode, FrameNode, GroupNode, RefNode, SceneNode } from '@/types/scene'

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

/** One `embed` descendant found while walking a container for compositing (FIR-63), positioned relative to the container's own top-left corner. */
interface EmbedTile {
  node: EmbedNode
  x: number
  y: number
  width: number
  height: number
}

function isExportSkipped(node: SceneNode): boolean {
  return node.visible === false || node.enabled === false || node.opacity === 0
}

/**
 * Resolve a `ref` (component instance) node to its expanded tree — overrides
 * applied, nested refs resolved recursively — or `null` if the component it
 * points at can no longer be found. Thin wrapper around
 * `instanceRuntime.resolveRefToTree` that pulls the flat `nodesById`/
 * `childrenById` straight from the store, matching how `exportPptxUtils.ts`'s
 * `resolveRef` dep is wired.
 */
function resolveRefNode(node: RefNode): FrameNode | null {
  const { nodesById, childrenById } = useSceneStore.getState()
  return resolveRefToTree(node, nodesById, childrenById)
}

/**
 * Recursively collect every visible `embed` descendant under `root` (`root`
 * itself excluded — callers rasterize an embed root directly via
 * `captureEmbedCanvas`), with its position relative to `root`'s own top-left
 * corner. Resolves auto-layout children level-by-level via
 * `calculateLayoutForFrame`, mirroring `buildSlidesInput.ts`'s `walkNode` —
 * needed so a `fill_container`/auto-layout embed's composited position uses
 * the layout engine's resolved x/y instead of its raw stored (pre-layout)
 * x/y. Note this is *not* guaranteed to be pixel-identical to the live
 * on-canvas overlay: `useOverlayHostRect.ts` currently positions the DOM
 * overlay from the node's raw stored `width`/`height`, not this same
 * layout-resolved size, for reasons unrelated to export — see that hook. A
 * `ref` (component instance) is expanded via `resolveRefToTree` and walked
 * like a frame, so an embed nested inside a component instance is composited
 * too instead of exporting as a transparent hole (FIR-63 review #1).
 */
function collectEmbedTiles(
  root: SceneNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): EmbedTile[] {
  const tiles: EmbedTile[] = []

  function childrenOf(node: SceneNode): SceneNode[] | undefined {
    if (node.type === 'frame') return calculateLayoutForFrame(node as FrameNode)
    if (node.type === 'group') return (node as GroupNode).children
    if (node.type === 'ref') return resolveRefNode(node as RefNode)?.children
    return undefined
  }

  function walk(node: SceneNode, parentAbsX: number, parentAbsY: number): void {
    if (isExportSkipped(node)) return
    const absX = parentAbsX + node.x
    const absY = parentAbsY + node.y

    if (node.type === 'embed') {
      tiles.push({ node: node as EmbedNode, x: absX, y: absY, width: node.width, height: node.height })
      return
    }

    const children = childrenOf(node)
    if (!children) return
    for (const child of children) walk(child, absX, absY)
  }

  const rootChildren = childrenOf(root)
  if (!rootChildren) return tiles
  for (const child of rootChildren) walk(child, 0, 0)
  return tiles
}

/**
 * Whether `nodeId` is itself an `embed`, or has one anywhere in its subtree
 * (descending through `ref` instances via `resolveRefToTree`, matching
 * `collectEmbedTiles`'s walk). Used by PPTX export (FIR-63 review #2) to
 * decide whether a rasterization failure must hard-fail the whole export
 * (an embed with no content, or a tainted cross-origin canvas — both
 * unrecoverable) rather than degrade gracefully to a skipped shape like any
 * other rasterization failure (WebGL context loss, an unexpected exception
 * in a fill/effect resolver, ...).
 */
export function nodeContainsEmbed(nodeId: string): boolean {
  const node = findTreeNode(nodeId)
  return node ? subtreeContainsEmbed(node) : false
}

function subtreeContainsEmbed(node: SceneNode): boolean {
  if (node.type === 'embed') return true
  if (node.type === 'ref') {
    const resolved = resolveRefNode(node as RefNode)
    return resolved ? subtreeContainsEmbed(resolved) : false
  }
  if (node.type === 'frame' || node.type === 'group') {
    return (node as FrameNode | GroupNode).children.some(subtreeContainsEmbed)
  }
  return false
}

/** Depth-first search of the full scene tree (`getNodes()`) for the tree-shaped node object matching `nodeId` — needed (rather than the flat `nodesById` entry) because `calculateLayoutForFrame`'s cache keys on frame object identity and expects a tree node's nested `children`. */
function findTreeNode(nodeId: string): SceneNode | null {
  const stack: SceneNode[] = [...useSceneStore.getState().getNodes()]
  while (stack.length > 0) {
    const node = stack.pop()!
    if (node.id === nodeId) return node
    const children = node.type === 'frame' ? (node as FrameNode).children : node.type === 'group' ? (node as GroupNode).children : undefined
    if (children) stack.push(...children)
  }
  return null
}

/**
 * Render a node to a canvas at `size × scale` px — the shared core of every
 * raster export path (PNG/JPG/WebP, and the PDF/PPTX/ZIP pages built on
 * `extractImageBytes` below).
 *
 * FIR-63: `embed` nodes render as a live Shadow-DOM overlay above PixiJS
 * (`EmbedLayer.tsx`), with a deliberately empty PixiJS container
 * (`embedRenderer.ts`) — `renderer.extract.canvas` alone would silently
 * produce a blank/transparent bitmap for one. This renders the embed's own
 * HTML instead (`captureEmbedCanvas`, shared with `get_screenshot`), and for
 * a frame/group/ref container additionally composites every embed
 * descendant's HTML on top of the Pixi-rendered background at its resolved
 * absolute position — descending into `ref` (component instance) subtrees
 * via `resolveRefToTree` — so a page/frame/instance containing embeds
 * doesn't export with transparent "holes" where they sit.
 *
 * Throws — never resolves a blank/partial canvas — when an embed can't be
 * rasterized: `captureEmbedCanvas` returns null (no content), or a later
 * `canvas.toDataURL()` call downstream throws a `SecurityError` because an
 * embed's HTML drew a cross-origin image with no CORS headers (a "tainted"
 * canvas propagates taint to anything it's drawn onto, including this
 * composite canvas). Callers must let that propagate to a failed
 * export/download rather than catching it into an empty file.
 */
export async function renderNodeToCanvas(
  pixiRefs: PixiExportRefs,
  nodeId: string,
  size: { width: number; height: number },
  scale: number,
): Promise<HTMLCanvasElement> {
  const { nodesById } = useSceneStore.getState()
  const node = nodesById[nodeId]
  if (!node) throw new Error(`Export failed: node "${nodeId}" not found in the scene`)

  if (node.type === 'embed') {
    const canvas = await captureEmbedCanvas(
      { htmlContent: (node as EmbedNode).htmlContent, width: size.width, height: size.height },
      scale,
      nodeId,
    )
    if (!canvas) {
      throw new Error(
        `Export failed: could not render embed "${node.name || nodeId}" — it has no content, or its HTML failed to rasterize.`,
      )
    }
    return canvas
  }

  const container = findContainerByLabel(pixiRefs.sceneRoot, nodeId)
  if (!container) throw new Error(`Export failed: node "${node.name || nodeId}" not found in the canvas`)

  const canvas = withForcedRenderable(container, pixiRefs.sceneRoot, () =>
    pixiRefs.app.renderer.extract.canvas({
      target: container,
      resolution: scale,
      antialias: true,
      frame: toExtractFrame(size.width, size.height),
    }) as HTMLCanvasElement,
  )

  if (node.type !== 'frame' && node.type !== 'group' && node.type !== 'ref') return canvas

  const treeNode = findTreeNode(nodeId)
  if (!treeNode) return canvas

  const { calculateLayoutForFrame } = useLayoutStore.getState()
  const tiles = collectEmbedTiles(treeNode, calculateLayoutForFrame)
  if (tiles.length === 0) return canvas

  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  for (const tile of tiles) {
    // A tile fully outside the container's own bounds never contributes —
    // skip it (and its capture) entirely. One partially outside is still
    // captured/drawn at its full resolved size; the out-of-bounds portion is
    // cropped implicitly by `ctx.drawImage` clipping to the destination
    // canvas's own pixel bounds, not by these left/top/right/bottom values —
    // they're only used for the emptiness check above.
    const left = Math.max(0, tile.x)
    const top = Math.max(0, tile.y)
    const right = Math.min(size.width, tile.x + tile.width)
    const bottom = Math.min(size.height, tile.y + tile.height)
    if (right <= left || bottom <= top) continue

    const embedCanvas = await captureEmbedCanvas(
      { htmlContent: tile.node.htmlContent, width: tile.width, height: tile.height },
      scale,
      tile.node.id,
    )
    if (!embedCanvas) {
      throw new Error(
        `Export failed: could not render embed "${tile.node.name || tile.node.id}" inside "${node.name || nodeId}" — it has no content, or its HTML failed to rasterize.`,
      )
    }
    ctx.drawImage(
      embedCanvas,
      0,
      0,
      embedCanvas.width,
      embedCanvas.height,
      tile.x * scale,
      tile.y * scale,
      tile.width * scale,
      tile.height * scale,
    )
  }

  return canvas
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

/**
 * Async (see `renderNodeToCanvas`): an `embed` node — or a frame/group
 * containing one — needs to render live HTML off-canvas, which is
 * inherently async. Callers (`exportPdfUtils.ts`, `exportPptxUtils.ts`,
 * `exportImagesZipUtils.ts`) already `await` their page-building loops.
 *
 * Takes `nodeId` (not a resolved `PixiContainer`) so it can special-case
 * `embed` nodes and composite embed descendants — see `renderNodeToCanvas`.
 * Rejects (never resolves a blank/partial image) when an embed can't be
 * rasterized.
 */
export async function extractImageBytes(
  pixiRefs: PixiExportRefs,
  nodeId: string,
  scale: number,
  size: { width: number; height: number },
  mimeType: string,
  quality?: number,
): Promise<Uint8Array> {
  const canvas = await renderNodeToCanvas(pixiRefs, nodeId, size, scale)
  const output = mimeType === 'image/jpeg' ? flattenOntoWhite(canvas) : canvas
  const dataUrl = output.toDataURL(mimeType, quality)
  return dataUrlToUint8Array(dataUrl)
}

/**
 * Like `exportImageFromPixi`, but takes an arbitrary numeric `scale` (export
 * settings allow 0.5x/1.5x/custom, not just the fixed 1/2/3 the toolbar
 * export uses) and an explicit `filename` (export settings compute their own
 * filename with suffix — see `buildExportFilename`), and supports webp.
 *
 * Rejects (rather than swallowing to a bare `false`) on failure: its one
 * caller (`runExportSettingsForNode`'s `exportRaster` runner in
 * `runExportAll.ts`) already wraps every setting's run in a try/catch that
 * turns a thrown error into `ExportRunResult.error`, which
 * `ExportSettingsList` can surface — swallowing here would otherwise discard
 * the reason (e.g. FIR-63: "no content, or its HTML failed to rasterize")
 * behind a plain `console.error` and an undifferentiated "N failed" (review
 * finding #10).
 */
export async function exportImageFromPixiWithFilename(
  pixiRefs: PixiExportRefs,
  nodeId: string | null,
  format: RasterExportFormat,
  scale: number,
  filename: string,
  quality?: number,
): Promise<boolean> {
  try {
    const mimeType = getExportSettingMimeType(format)
    const encoderQuality = quality ?? (format === 'png' ? undefined : 0.92)

    if (nodeId) {
      const { width, height } = getNodeExportSize(nodeId)
      // renderNodeToCanvas (FIR-63) special-cases `embed` nodes — and
      // composites embed descendants of a frame/group — instead of the bare
      // `extract.canvas` this used to call directly, which would otherwise
      // silently produce a blank/see-through bitmap for embed content.
      const extracted = await renderNodeToCanvas(pixiRefs, nodeId, { width, height }, scale)
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
    throw error
  }
}
