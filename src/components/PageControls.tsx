import { useMemo } from "react";
import { PlayIcon } from "@phosphor-icons/react";

import { Button } from "@/components/ui/button";
import { SelectWithOptions } from "@/components/ui/select";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";

const ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200, 300];

function getCanvasMetrics() {
  const canvasEl = document.querySelector("[data-canvas]");
  const rect = canvasEl?.getBoundingClientRect();

  return {
    width: canvasEl?.clientWidth ?? window.innerWidth,
    height: canvasEl?.clientHeight ?? window.innerHeight,
    centerX: rect ? rect.left + rect.width / 2 : window.innerWidth / 2,
    centerY: rect ? rect.top + rect.height / 2 : window.innerHeight / 2,
  };
}

export function PageControls() {
  const scale = useViewportStore((s) => s.scale);
  const zoomAtPoint = useViewportStore((s) => s.zoomAtPoint);
  const fitToContent = useViewportStore((s) => s.fitToContent);

  const currentZoom = Math.round(scale * 100);
  const zoomOptions = useMemo(() => {
    const presetOptions = ZOOM_PRESETS.map((value) => ({
      value: String(value),
      label: `${value}%`,
    }));
    const options = [
      { value: "fit", label: "Fit to content" },
      ...presetOptions,
    ];

    if (ZOOM_PRESETS.includes(currentZoom)) {
      return options;
    }

    return [
      options[0],
      ...[...presetOptions, { value: String(currentZoom), label: `${currentZoom}%` }].sort(
        (a, b) => Number(a.value) - Number(b.value),
      ),
    ];
  }, [currentZoom]);

  const handleZoomChange = (value: string | null) => {
    if (!value) return;

    if (value === "fit") {
      const nodes = useSceneStore.getState().getNodes();
      const { width, height } = getCanvasMetrics();
      fitToContent(nodes, width, height);
      return;
    }

    const nextScale = Number(value) / 100;
    if (!Number.isFinite(nextScale)) return;

    const { centerX, centerY } = getCanvasMetrics();
    zoomAtPoint(nextScale, centerX, centerY);
  };

  return (
    <div className="border-b border-border-default px-3 py-3">
      <div className="flex items-center gap-2">
        <SelectWithOptions
          value={String(currentZoom)}
          onValueChange={handleZoomChange}
          options={zoomOptions}
          className="w-auto min-w-0 border-transparent bg-transparent px-2 hover:bg-muted hover:text-foreground focus-visible:border-transparent focus-visible:ring-0"
          size="sm"
        />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Play">
            <PlayIcon />
          </Button>
          <Button variant="secondary" size="sm">
            Share
          </Button>
        </div>
      </div>
    </div>
  );
}
