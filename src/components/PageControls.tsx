import { useMemo } from "react";
import { PlayIcon, CodeIcon } from "@phosphor-icons/react";

import { SelectWithOptions } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { formatShortcut } from "@/lib/commands/shortcutFormat";

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
  const enterPresent = useEditorModeStore((s) => s.enterPresent);
  const isDevMode = useDevModeStore((s) => s.active);
  const toggleDevMode = useDevModeStore((s) => s.toggle);

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
          className="w-auto min-w-0 border-transparent bg-transparent px-2 hover:bg-secondary hover:text-foreground focus-visible:border-transparent focus-visible:ring-0"
          size="sm"
        />
        {/* Dev (inspect) mode toggle — Figma-style read-only CSS inspector. */}
        <IconButton
          variant="ghost"
          size="icon-sm"
          tooltip="Dev mode"
          shortcut={formatShortcut(["shift", "D"])}
          className={
            isDevMode
              ? "ml-auto bg-green-500/20 text-green-500 hover:bg-green-500/20 hover:text-green-500"
              : "ml-auto"
          }
          onClick={() => toggleDevMode()}
          data-testid="page-dev-mode"
        >
          <CodeIcon size={16} weight="light" />
        </IconButton>
        {/* Primary "Play" button — opens fullscreen Present mode. */}
        <Button
          variant="default"
          size="sm"
          className="gap-1.5 h-auto px-3 py-1.5 -my-1.5 bg-accent-primary text-white hover:bg-accent-primary/90"
          onClick={() => enterPresent()}
          title="Present (fullscreen)"
          data-testid="page-present"
        >
          <PlayIcon size={14} weight="light" />
          Play
        </Button>
      </div>
    </div>
  );
}
