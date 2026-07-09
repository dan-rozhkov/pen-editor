import { useState } from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { PropertySection, SelectInput } from "@/components/ui/PropertyInputs";
import { Button } from "@/components/ui/button";

/**
 * Page-level export shown when nothing is selected (inside `PageProperties`).
 * This is the one capability the removed per-node `ExportSection` offered that
 * the per-node `ExportSettingsSection` does not: exporting every top-level
 * frame of the page as a single multi-page PDF. Per-node/per-format/suffix
 * export now lives solely in `ExportSettingsSection`, so there is exactly one
 * per-node export UI and this page-level action alongside it.
 */
export function PageExportSection() {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
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
      const { exportFramesToPdf, getTopLevelFrames } = await import("@/utils/exportPdfUtils");
      const frames = getTopLevelFrames();
      if (frames.length === 0) {
        setStatus("No frames on this page to export");
        return;
      }
      // No filename → resolvePdfDownloadFilename derives "canvas.pdf".
      const ok = await exportFramesToPdf(pixiRefs, frames, scale);
      setStatus(ok ? `Exported ${frames.length} frame${frames.length === 1 ? "" : "s"} to PDF.` : "Export failed");
    } finally {
      setIsExporting(false);
    }
  };

  const scaleOptions = [
    { value: "1", label: "1x" },
    { value: "2", label: "2x" },
    { value: "3", label: "3x" },
  ];

  return (
    <PropertySection title="Export page">
      <div className="flex flex-col gap-2">
        <SelectInput
          label="Scale"
          labelOutside
          value={String(scale)}
          options={scaleOptions}
          onChange={(v) => setScale(Number(v))}
        />
        <Button
          onClick={handleExportAllFrames}
          disabled={isExporting}
          variant="secondary"
          className="w-full min-w-0"
        >
          <DownloadSimpleIcon />
          <span className="min-w-0 truncate">
            {isExporting ? "Exporting…" : "Export all frames (PDF)"}
          </span>
        </Button>
        {status && <div className="text-[10px] text-text-muted">{status}</div>}
      </div>
    </PropertySection>
  );
}
