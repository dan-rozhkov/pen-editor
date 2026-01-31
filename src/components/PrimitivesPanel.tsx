import {
  SquareIcon,
  CircleIcon,
  TextTIcon,
  CursorIcon,
} from "@phosphor-icons/react";
import { FrameIcon } from "./ui/custom-icons/frame-icon";
import { useDrawModeStore, type DrawToolType } from "../store/drawModeStore";
import { Button } from "./ui/button";

export function PrimitivesPanel() {
  const { activeTool, toggleTool, setActiveTool } = useDrawModeStore();

  const tools: Array<{
    icon: React.ComponentType<{ className?: string; size?: number }>;
    label: string;
    tool: DrawToolType;
    shortcut: string;
  }> = [
    { icon: CursorIcon, label: "Select", tool: "cursor", shortcut: "V" },
    { icon: FrameIcon, label: "Frame", tool: "frame", shortcut: "F" },
    { icon: SquareIcon, label: "Rectangle", tool: "rect", shortcut: "R" },
    { icon: CircleIcon, label: "Ellipse", tool: "ellipse", shortcut: "O" },
    { icon: TextTIcon, label: "Text", tool: "text", shortcut: "T" },
  ];

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-2 bg-surface-panel/95 backdrop-blur-sm border border-border-default rounded-xl shadow-lg">
        {tools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive =
            tool === "cursor" ? activeTool === null : activeTool === tool;
          return (
            <Button
              key={label}
              onClick={() =>
                tool === "cursor" ? setActiveTool(null) : toggleTool(tool)
              }
              title={`${label} (${shortcut})`}
              variant="ghost"
              size="icon-lg"
              className={`group relative ${
                isActive
                  ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
                  : "text-text-secondary hover:text-text-primary hover:bg-surface-elevated"
              }`}
            >
              <Icon size={20} />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
