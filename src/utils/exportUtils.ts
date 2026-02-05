import Konva from 'konva'

export type ExportFormat = 'png' | 'jpeg'
export type ExportScale = 1 | 2 | 3

interface ExportOptions {
  format: ExportFormat
  scale: ExportScale
  viewportScale?: number
  filename?: string
}

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

/**
 * Get MIME type for export format
 */
function getMimeType(format: ExportFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png'
}

/**
 * Get file extension for export format
 */
function getExtension(format: ExportFormat): string {
  return format === 'jpeg' ? 'jpg' : 'png'
}

/**
 * Generate export filename with scale label
 */
function generateFilename(
  baseName: string,
  format: ExportFormat,
  scale: ExportScale
): string {
  const ext = getExtension(format)
  const scaleLabel = scale > 1 ? `@${scale}x` : ''
  return `${baseName}${scaleLabel}.${ext}`
}

/**
 * Export a specific node as an image
 */
export function exportNodeAsImage(
  stage: Konva.Stage,
  nodeId: string,
  options: ExportOptions
): boolean {
  const { format, scale, viewportScale = 1, filename } = options

  // Find the node by ID
  const node = stage.findOne(`#${nodeId}`)
  if (!node) {
    console.error(`Node with id "${nodeId}" not found`)
    return false
  }

  try {
    // Compensate for viewport zoom so export size matches real node dimensions
    const dataUrl = node.toDataURL({
      pixelRatio: scale / viewportScale,
      mimeType: getMimeType(format),
      quality: format === 'jpeg' ? 0.92 : undefined,
    })

    // Generate filename
    const nodeName = (node.attrs.name as string) || node.getClassName() || 'element'
    const sanitizedName = nodeName.replace(/[^a-zA-Z0-9_-]/g, '_')
    const finalFilename = filename || generateFilename(sanitizedName, format, scale)

    downloadDataUrl(dataUrl, finalFilename)
    return true
  } catch (error) {
    console.error('Failed to export node:', error)
    return false
  }
}

/**
 * Export visible canvas content as an image
 */
export function exportCanvasAsImage(
  stage: Konva.Stage,
  options: ExportOptions
): boolean {
  const { format, scale, viewportScale = 1, filename } = options

  try {
    // Compensate for viewport zoom so export size matches real canvas dimensions
    const dataUrl = stage.toDataURL({
      pixelRatio: scale / viewportScale,
      mimeType: getMimeType(format),
      quality: format === 'jpeg' ? 0.92 : undefined,
    })

    // Generate filename
    const finalFilename = filename || generateFilename('canvas', format, scale)

    downloadDataUrl(dataUrl, finalFilename)
    return true
  } catch (error) {
    console.error('Failed to export canvas:', error)
    return false
  }
}

/**
 * Export selected element or entire canvas
 * If nodeId is provided and found, exports that node
 * Otherwise exports the entire canvas
 */
export function exportImage(
  stage: Konva.Stage,
  nodeId: string | null,
  nodeName: string | undefined,
  options: Omit<ExportOptions, 'filename'>
): boolean {
  const { format, scale, viewportScale = 1 } = options

  if (nodeId) {
    // Try to export the specific node
    const node = stage.findOne(`#${nodeId}`)
    if (node) {
      const name = nodeName || node.getClassName() || 'element'
      const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_')
      const filename = generateFilename(sanitizedName, format, scale)

      return exportNodeAsImage(stage, nodeId, { format, scale, viewportScale, filename })
    }
  }

  // Fall back to exporting the entire canvas
  return exportCanvasAsImage(stage, { format, scale, viewportScale })
}
