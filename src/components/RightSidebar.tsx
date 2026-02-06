import type { RendererMode } from "@/App";
import { SelectWithOptions } from "@/components/ui/select";
import { useSelectionStore } from "@/store/selectionStore";
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
  const showRendererSelect = selectedIds.length === 0;

  return (
    <div className="w-[260px] h-full flex flex-col bg-surface-panel border-l border-border-default">
      <PropertiesPanel />
      {showRendererSelect && (
        <div className="border-t border-border-default px-4 py-3">
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
      )}
    </div>
  );
}
