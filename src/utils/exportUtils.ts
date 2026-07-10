import { Rectangle, type Container as PixiContainer } from 'pixi.js'
import type { PixiExportRefs } from '@/store/canvasRefStore'
import { getExportSettingMimeType } from '@/utils/exportSettingsUtils'
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

/** Raster formats + arbitrary scale, as used by per-node export settings (`exportSettingsUtils`). */
export type RasterExportFormat = 'png' | 'jpg' | 'webp'

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
