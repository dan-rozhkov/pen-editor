import { SquareIcon, CircleIcon, TextTIcon } from "@phosphor-icons/react";
import { FrameIcon } from "./ui/custom-icons/frame-icon";
import { useDrawModeStore, type DrawToolType } from "../store/drawModeStore";
import { Button } from "./ui/button";

export function PrimitivesPanel() {
  const { activeTool, toggleTool } = useDrawModeStore();

  const tools: Array<{
    icon: React.ComponentType<{ className?: string; size?: number }>;
    label: string;
    tool: DrawToolType;
    shortcut: string;
  }> = [
    { icon: FrameIcon, label: "Frame", tool: "frame", shortcut: "F" },
    { icon: SquareIcon, label: "Rectangle", tool: "rect", shortcut: "R" },
    { icon: CircleIcon, label: "Ellipse", tool: "ellipse", shortcut: "O" },
    { icon: TextTIcon, label: "Text", tool: "text", shortcut: "T" },
  ];

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 px-2 py-2 bg-surface-panel/95 backdrop-blur-sm border border-border-default rounded-xl shadow-lg">
        {tools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive = activeTool === tool;
          return (
            <Button
              key={label}
              onClick={() => toggleTool(tool)}
              title={`${label} (${shortcut})`}
              variant="ghost"
              size="icon-lg"
              className={`group relative ${
                isActive
                  ? "bg-blue-500 text-white hover:bg-blue-600"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
              }`}
            >
              <Icon size={20} />
              <span className="absolute -top-8 left-1/2 -translate-x-1/2 px-2 py-1 bg-surface-elevated text-text-primary text-xs rounded shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap pointer-events-none">
                {label}
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
