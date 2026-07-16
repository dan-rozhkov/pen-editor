import { useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";
import { resolvePageExportKind, type PageExportFormat } from "@/utils/pageExportFormat";

/**
 * Page-level export shown when nothing is selected (inside `PageProperties`).
 * Exports every top-level frame of the page at once, in one of two shapes
 * depending on the selected format:
 * - PDF: all frames become pages of a single multi-page PDF
 *   (`exportFramesToPdf`), one page per frame.
 * - PNG/JPG/WebP: each frame is rasterized independently and bundled into a
 *   single ZIP archive (`exportFramesToImagesZip`), one image per frame.
 * Per-node/per-format/suffix export (including SVG) lives solely in the
 * separate `ExportSettingsSection`; this is the only page-level export UI.
 */
export function PageExportSection() {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const [format, setFormat] = useState<PageExportFormat>("png");
  const [scale, setScale] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const handleExportAllFrames = async () => {
    if (!pixiRefs) {
      setStatus("Canvas is not ready");
      return;
    }
    setIsExporting(true);
    setStatus(null);
    try {
      // exportUtils is format-neutral (no pdf-lib) — safe to load unconditionally.
      const { getTopLevelFrames } = await import("@/utils/exportUtils");
      const frames = getTopLevelFrames();
      if (frames.length === 0) {
        setStatus("No frames on this page to export");
        return;
      }

      if (resolvePageExportKind(format) === "pdf") {
        const { exportFramesToPdf } = await import("@/utils/exportPdfUtils");
        // No filename → resolvePdfDownloadFilename derives "canvas.pdf".
        const ok = await exportFramesToPdf(pixiRefs, frames, scale);
        const frameCount = `${frames.length} frame${frames.length === 1 ? "" : "s"}`;
        setStatus(ok ? `Exported ${frameCount} to PDF.` : "Export failed");
      } else {
        const { exportFramesToImagesZip } = await import("@/utils/exportImagesZipUtils");
        const fileCount = await exportFramesToImagesZip(pixiRefs, frames, format as Exclude<PageExportFormat, "pdf">, scale);
        setStatus(
          fileCount !== null ? `Exported ${fileCount} frame${fileCount === 1 ? "" : "s"} to ZIP.` : "Export failed",
        );
      }
    } finally {
      setIsExporting(false);
    }
  };

  const formatOptions = [
    { value: "png", label: "PNG" },
    { value: "jpg", label: "JPG" },
    { value: "webp", label: "WebP" },
    { value: "pdf", label: "PDF" },
  ];

  const scaleOptions = [
    { value: "1", label: "1x" },
    { value: "2", label: "2x" },
    { value: "3", label: "3x" },
  ];

  return (
    <PropertySection title="Export page">
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <SelectInput
            value={format}
            options={formatOptions}
            onChange={(v) => {
              setFormat(v as PageExportFormat);
              setStatus(null);
            }}
          />
          <SelectInput
            value={String(scale)}
            options={scaleOptions}
            onChange={(v) => {
              setScale(Number(v));
              setStatus(null);
            }}
          />
        </div>
        <Button
          onClick={handleExportAllFrames}
          disabled={isExporting}
          variant="outline"
          className="w-full min-w-0"
        >
          <span className="min-w-0 truncate">
            {isExporting ? "Exporting…" : "Export all frames"}
          </span>
        </Button>
        {status && <div className="text-[10px] text-text-muted">{status}</div>}
      </div>
    </PropertySection>
  );
}
