import {
  SquareIcon,
  CircleIcon,
  TextTIcon,
  NavigationArrowIcon,
  LineSegmentIcon,
  HexagonIcon,
  type IconWeight,
} from "@phosphor-icons/react";
import { FrameIcon } from "./ui/custom-icons/frame-icon";
import { useDrawModeStore, type DrawToolType } from "../store/drawModeStore";
import { Button } from "./ui/button";

export function PrimitivesPanel() {
  const { activeTool, toggleTool, setActiveTool } = useDrawModeStore();

  const tools: Array<{
    icon: React.ComponentType<{
      className?: string;
      size?: number;
      weight?: IconWeight;
    }>;
    label: string;
    tool: DrawToolType;
    shortcut: string;
  }> = [
    {
      icon: NavigationArrowIcon,
      label: "Select",
      tool: "cursor",
      shortcut: "V",
    },
    { icon: FrameIcon, label: "Frame", tool: "frame", shortcut: "F" },
    { icon: SquareIcon, label: "Rectangle", tool: "rect", shortcut: "R" },
    { icon: CircleIcon, label: "Ellipse", tool: "ellipse", shortcut: "O" },
    { icon: TextTIcon, label: "Text", tool: "text", shortcut: "T" },
    { icon: LineSegmentIcon, label: "Line", tool: "line", shortcut: "L" },
    { icon: HexagonIcon, label: "Polygon", tool: "polygon", shortcut: "P" },
  ];

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-2 bg-surface-panel/95 backdrop-blur-sm border border-border-default rounded-2xl shadow-lg">
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
              size="lg"
              className={`group relative size-9 p-0 rounded-lg transition-none outline-none ${
                isActive
                  ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-surface-elevated"
              }`}
            >
              <Icon size={40} className="size-6" weight="light" />
            </Button>
          );
        })}
      </div>
    </div>
  );
}
