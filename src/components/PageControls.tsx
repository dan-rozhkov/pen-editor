import { CaretDownIcon, CheckIcon, CodeIcon } from "@phosphor-icons/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useDevModeStore } from "@/store/devModeStore";
import { formatShortcut } from "@/lib/commands/shortcutFormat";
import { getCanvasViewportCenter, getCanvasViewportMetrics } from "@/utils/canvasViewport";

const ZOOM_PRESETS = [25, 50, 75, 100, 125, 150, 200, 300];

export function PageControls() {
  const scale = useViewportStore((s) => s.scale);
  const zoomAtPoint = useViewportStore((s) => s.zoomAtPoint);
  const fitToContent = useViewportStore((s) => s.fitToContent);
  const enterPresent = useEditorModeStore((s) => s.enterPresent);
  const isDevMode = useDevModeStore((s) => s.active);
  const toggleDevMode = useDevModeStore((s) => s.toggle);

  const currentZoom = Math.round(scale * 100);

  const handleFitToContent = () => {
    const nodes = useSceneStore.getState().getNodes();
    const { width, height } = getCanvasViewportMetrics();
    fitToContent(nodes, width, height);
  };

  const handleZoomPreset = (value: number) => {
    const { centerX, centerY } = getCanvasViewportCenter();
    zoomAtPoint(value / 100, centerX, centerY);
  };

  return (
    <div className="border-b border-border-default px-3 py-3">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="w-auto min-w-0 gap-1.5 px-2"
                data-testid="page-zoom"
              />
            }
          >
            {currentZoom}%
            <CaretDownIcon className="size-3.5 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="min-w-32">
            <DropdownMenuItem onClick={handleFitToContent} data-testid="page-zoom-fit">
              Fit to content
            </DropdownMenuItem>
            {ZOOM_PRESETS.map((value) => (
              <DropdownMenuItem
                key={value}
                onClick={() => handleZoomPreset(value)}
                data-testid={`page-zoom-${value}`}
              >
                {value}%
                {value === currentZoom && <CheckIcon className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* Dev (inspect) mode toggle — Figma-style read-only CSS inspector. */}
        <IconButton
          variant="ghost"
          size="icon"
          tooltip="Dev mode"
          shortcut={formatShortcut(["shift", "D"])}
          className={
            isDevMode
              ? "ml-auto size-[33.5px] bg-green-500/20 text-green-500 hover:bg-green-500/20 hover:text-green-500"
              : "ml-auto size-[33.5px]"
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
          className="gap-1.5 h-auto px-3 py-1.5 -my-1.5 border-transparent bg-accent-primary text-white hover:bg-accent-primary/90"
          onClick={() => enterPresent()}
          title="Present (fullscreen)"
          data-testid="page-present"
        >
          Play
        </Button>
      </div>
    </div>
  );
}
