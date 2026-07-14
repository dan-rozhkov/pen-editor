import type { ExportSetting } from "@/types/scene";
import type { PixiExportRefs } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { buildExportFilename, isRasterExportFormat } from "@/utils/exportSettingsUtils";

export interface ExportRunResult {
  settingId: string;
  format: ExportSetting["format"];
  filename: string;
  success: boolean;
  warnings?: string[];
  error?: string;
}

/**
 * The Pixi/DOM/file-I/O side of running one `ExportSetting` — swappable so
 * `runExportSettingsForNode`/`runExportAllOnNodes` (the orchestration/filename
 * logic) can be unit-tested without touching PixiJS or triggering real
 * downloads. `defaultExportRunners` (below) is the real implementation used
 * by the UI.
 */
export interface ExportRunners {
  exportSvg: (nodeId: string, nodeName: string | undefined, filename: string) => Promise<{ warnings: string[] }>;
  exportRaster: (
    pixiRefs: PixiExportRefs | null,
    nodeId: string,
    format: "png" | "jpg" | "webp",
    scale: number,
    filename: string,
    quality?: number,
  ) => Promise<boolean>;
  exportPdf: (
    pixiRefs: PixiExportRefs | null,
    nodeId: string,
    nodeName: string | undefined,
    scale: number,
    filename: string,
  ) => Promise<boolean>;
}

/**
 * Real runners used by the app: SVG via `exportSvgUtils`, raster via
 * `exportImageFromPixiWithFilename`, PDF via `exportFramesToPdf` (single
 * frame/node, one page). Lazy-imported so unit tests that never call
 * `defaultExportRunners` never load Pixi.
 */
export const defaultExportRunners: ExportRunners = {
  exportSvg: async (nodeId, nodeName, filename) => {
    const { nodesById, childrenById } = useSceneStore.getState();
    const { exportNodeToSvgFile } = await import("@/utils/exportSvgUtils");
    return exportNodeToSvgFile(nodeId, nodeName, nodesById, childrenById, filename);
  },
  exportRaster: async (pixiRefs, nodeId, format, scale, filename, quality) => {
    if (!pixiRefs) return false;
    const { exportImageFromPixiWithFilename } = await import("@/utils/exportUtils");
    return exportImageFromPixiWithFilename(pixiRefs, nodeId, format, scale, filename, quality);
  },
  exportPdf: async (pixiRefs, nodeId, nodeName, scale, filename) => {
    if (!pixiRefs) return false;
    const [{ exportFramesToPdf }, { getFrameDescriptor }] = await Promise.all([
      import("@/utils/exportPdfUtils"),
      import("@/utils/exportUtils"),
    ]);
    const frame = getFrameDescriptor(nodeId, nodeName);
    // Pass the already-built filename (e.g. "Icon@2x.pdf") verbatim so the
    // downloaded file matches the reported result filename (keeps the @Nx label).
    return exportFramesToPdf(pixiRefs, [frame], scale, filename);
  },
};

/**
 * Run every configured `ExportSetting` for one node, dispatching each to the
 * right exporter and computing its filename (base name + suffix + scale
 * label + extension, see `buildExportFilename`). Pure orchestration —
 * `runners` defaults to the real Pixi-touching implementation but tests pass
 * a fake to assert dispatch/filename behavior without PixiJS.
 */
export async function runExportSettingsForNode(
  nodeId: string,
  nodeName: string | undefined,
  settings: ExportSetting[],
  pixiRefs: PixiExportRefs | null,
  runners: ExportRunners = defaultExportRunners,
): Promise<ExportRunResult[]> {
  const results: ExportRunResult[] = [];
  const baseName = nodeName || nodeId;

  for (const setting of settings) {
    const filename = buildExportFilename(baseName, setting);
    try {
      if (setting.format === "svg") {
        const { warnings } = await runners.exportSvg(nodeId, nodeName, filename);
        results.push({ settingId: setting.id, format: setting.format, filename, success: true, warnings });
        continue;
      }
      if (setting.format === "pdf") {
        const success = await runners.exportPdf(pixiRefs, nodeId, nodeName, setting.scale, filename);
        results.push({ settingId: setting.id, format: setting.format, filename, success });
        continue;
      }
      if (isRasterExportFormat(setting.format)) {
        const success = await runners.exportRaster(
          pixiRefs,
          nodeId,
          setting.format as "png" | "jpg" | "webp",
          setting.scale,
          filename,
          setting.quality,
        );
        results.push({ settingId: setting.id, format: setting.format, filename, success });
        continue;
      }
      results.push({
        settingId: setting.id,
        format: setting.format,
        filename,
        success: false,
        error: `Unsupported export format: ${setting.format}`,
      });
    } catch (error) {
      results.push({
        settingId: setting.id,
        format: setting.format,
        filename,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
