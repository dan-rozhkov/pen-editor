import { useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useViewportStore } from "@/store/viewportStore";
import type { ExportFormat, ExportScale } from "@/utils/exportUtils";
import type { SceneNode } from "@/types/scene";
import { Button } from "@/components/ui/button";
import { SelectWithOptions } from "@/components/ui/select";
import { PropertySection } from "@/components/ui/PropertyInputs";

interface ExportSectionProps {
  selectedNode: SceneNode | null;
}

export function ExportSection({ selectedNode }: ExportSectionProps) {
  const stageRef = useCanvasRefStore((s) => s.stageRef);
  const viewportScale = useViewportStore((s) => s.scale);
  const [scale, setScale] = useState<ExportScale>(1);
  const [format, setFormat] = useState<ExportFormat>("png");

  const handleExport = async () => {
    if (!stageRef) {
      console.error("Stage ref not available");
      return;
    }

    const { exportImage } = await import("@/utils/exportUtils");
    exportImage(stageRef, selectedNode?.id || null, selectedNode?.name, {
      format,
      scale,
      viewportScale,
    });
  };

  const scaleOptions = [
    { value: "1", label: "1×" },
    { value: "2", label: "2×" },
    { value: "3", label: "3×" },
  ];

  const formatOptions = [
    { value: "png", label: "PNG" },
    { value: "jpeg", label: "JPEG" },
  ];

  const exportName = selectedNode?.name || "Untitled";

  return (
    <PropertySection title="Export">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <SelectWithOptions
              value={String(scale)}
              onValueChange={(v) => setScale(Number(v) as ExportScale)}
              options={scaleOptions}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="flex-1">
            <SelectWithOptions
              value={format}
              onValueChange={(v) => setFormat(v as ExportFormat)}
              options={formatOptions}
              size="sm"
              className="w-full"
            />
          </div>
        </div>
        <Button onClick={handleExport} variant="secondary" className="w-full">
          Export {exportName}
        </Button>
      </div>
    </PropertySection>
  );
}
