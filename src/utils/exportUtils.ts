import type { Container as PixiContainer } from 'pixi.js'
import type { PixiExportRefs } from '@/store/canvasRefStore'
import { getExportSettingMimeType } from '@/utils/exportSettingsUtils'

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
      const extracted = pixiRefs.app.renderer.extract.canvas({
        target: targetNode,
        resolution: scale,
        antialias: true,
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
