import type { RendererMode } from "@/App";
import { SelectWithOptions } from "@/components/ui/select";
import { useSelectionStore } from "@/store/selectionStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { Moon, Sun } from "@phosphor-icons/react";
import { Button } from "./ui/button";
import { PropertiesPanel } from "./PropertiesPanel";

interface RightSidebarProps {
  rendererMode: RendererMode;
  onRendererModeChange: (mode: RendererMode) => void;
}

const rendererOptions = [
  { value: "konva", label: "Konva" },
  { value: "pixi", label: "Pixi" },
];

export function RightSidebar({
  rendererMode,
  onRendererModeChange,
}: RightSidebarProps) {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const showEditorSettings = selectedIds.length === 0;
  const uiTheme = useUIThemeStore((s) => s.uiTheme);
  const toggleUITheme = useUIThemeStore((s) => s.toggleUITheme);

  return (
    <div className="w-[260px] h-full flex flex-col bg-surface-panel border-l border-border-default">
      <PropertiesPanel />
      {showEditorSettings && (
        <div className="mt-auto border-t border-border-default">
          <div className="px-4 py-3">
            <div className="text-[11px] font-semibold text-text-primary mb-2">
              Renderer
            </div>
            <SelectWithOptions
              value={rendererMode}
              onValueChange={(value) => {
                if (value === "konva" || value === "pixi") {
                  onRendererModeChange(value);
                }
              }}
              options={rendererOptions}
              size="sm"
              className="w-full"
            />
          </div>
          <div className="px-4 py-3 flex items-center justify-between border-t border-border-default">
            <span className="text-[11px] font-semibold text-text-primary">Theme</span>
            <Button variant="secondary" size="sm" onClick={toggleUITheme}>
              {uiTheme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
