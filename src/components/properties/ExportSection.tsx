import { useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSceneStore } from "@/store/sceneStore";
import type { ExportFormat, ExportScale } from "@/utils/exportUtils";
import type { SceneNode } from "@/types/scene";
import { Button } from "@/components/ui/button";
import { SelectWithOptions } from "@/components/ui/select";
import { PropertySection } from "@/components/ui/PropertyInputs";

interface ExportSectionProps {
  selectedNode: SceneNode | null;
}

type UiExportFormat = ExportFormat | "svg";

export function ExportSection({ selectedNode }: ExportSectionProps) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const viewportScale = useViewportStore((s) => s.scale);
  const [scale, setScale] = useState<ExportScale>(1);
  const [format, setFormat] = useState<UiExportFormat>("png");

  const handleExport = async () => {
    const nodeId = selectedNode?.id || null;
    const nodeName = selectedNode?.name;

    if (format === "svg") {
      if (!nodeId) {
        console.error("Select a node to export as SVG");
        return;
      }
      const { nodesById, childrenById } = useSceneStore.getState();
      const { exportNodeToSvgFile } = await import("@/utils/exportSvgUtils");
      exportNodeToSvgFile(nodeId, nodeName, nodesById, childrenById);
      return;
    }

    if (!pixiRefs) {
      console.error("Pixi refs are not available");
      return;
    }
    const { exportImageFromPixi } = await import("@/utils/exportUtils");
    exportImageFromPixi(pixiRefs, nodeId, nodeName, {
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
    { value: "svg", label: "SVG" },
  ];

  const exportName = selectedNode?.name || "Untitled";

  return (
    <PropertySection title="Export">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {format !== "svg" && (
            <div className="flex-1">
              <SelectWithOptions
                value={String(scale)}
                onValueChange={(v) => setScale(Number(v) as ExportScale)}
                options={scaleOptions}
                size="sm"
                className="w-full"
              />
            </div>
          )}
          <div className="flex-1">
            <SelectWithOptions
              value={format}
              onValueChange={(v) => setFormat(v as UiExportFormat)}
              options={formatOptions}
              size="sm"
              className="w-full"
            />
          </div>
        </div>
        <Button onClick={handleExport} variant="secondary" className="w-full min-w-0">
          <span className="min-w-0 truncate">Export {exportName}</span>
        </Button>
      </div>
    </PropertySection>
  );
}
