import {
  SquareIcon,
  CircleIcon,
  TextTIcon,
  NavigationArrowIcon,
  LineSegmentIcon,
  HexagonIcon,
  HashStraight,
  PencilSimple,
  FlowArrow,
  type IconWeight,
  CaretDownIcon,
  CodeIcon,
  MagicWand,
} from "@phosphor-icons/react";
import { useDrawModeStore, type DrawToolType } from "../store/drawModeStore";
import { Button } from "./ui/button";
import { ButtonGroup } from "./ui/button-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function PrimitivesPanel() {
  const { activeTool, toggleTool, setActiveTool } = useDrawModeStore();

  const leadingTools: Array<{
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
    { icon: HashStraight, label: "Frame", tool: "frame", shortcut: "F" },
  ];

  const trailingTools: Array<{
    icon: React.ComponentType<{
      className?: string;
      size?: number;
      weight?: IconWeight;
    }>;
    label: string;
    tool: DrawToolType;
    shortcut: string;
  }> = [
    { icon: PencilSimple, label: "Pencil", tool: "pencil", shortcut: "D" },
    { icon: CircleIcon, label: "Ellipse", tool: "ellipse", shortcut: "O" },
    { icon: TextTIcon, label: "Text", tool: "text", shortcut: "T" },
    { icon: CodeIcon, label: "Embed", tool: "embed", shortcut: "E" },
    { icon: MagicWand, label: "Shader", tool: "shader", shortcut: "S" },
  ];

  const rectSubTools: Array<{
    icon: React.ComponentType<{
      className?: string;
      size?: number;
      weight?: IconWeight;
    }>;
    label: string;
    tool: DrawToolType;
    shortcut: string;
  }> = [
    { icon: LineSegmentIcon, label: "Line", tool: "line", shortcut: "L" },
    { icon: HexagonIcon, label: "Polygon", tool: "polygon", shortcut: "P" },
    { icon: FlowArrow, label: "Connector", tool: "connector", shortcut: "C" },
  ];

  const isRectSubToolActive = rectSubTools.some((t) => t.tool === activeTool);
  const isRectangleActive = activeTool === "rect";
  const toolButtonBaseClass =
    "group relative size-9 p-0 rounded-lg transition-none outline-none";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-2 bg-surface-panel border border-border-default rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
        {leadingTools.map(({ icon: Icon, label, tool, shortcut }) => {
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
              className={`${toolButtonBaseClass} ${
                isActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <Icon size={40} className="size-6" weight="light" />
            </Button>
          );
        })}

        <DropdownMenu>
          <ButtonGroup orientation="horizontal" className="gap-0">
            <Button
              variant="ghost"
              size="lg"
              title="Rectangle (R)"
              onClick={() => toggleTool("rect")}
              className={`${toolButtonBaseClass} ${
                isRectangleActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <SquareIcon size={40} className="size-6" weight="light" />
            </Button>

            <DropdownMenuTrigger>
              <Button
                variant="ghost"
                size="lg"
                title="Line, Polygon"
                className={`${toolButtonBaseClass} w-6 justify-center ${
                  isRectSubToolActive
                    ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                    : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
                }`}
              >
                <CaretDownIcon size={12} className="size-3" weight="bold" />
              </Button>
            </DropdownMenuTrigger>
          </ButtonGroup>

          <DropdownMenuContent align="center" sideOffset={8}>
            {rectSubTools.map(({ icon: Icon, label, tool, shortcut }) => {
              const isActive = activeTool === tool;
              return (
                <DropdownMenuItem
                  key={label}
                  onClick={() => toggleTool(tool)}
                  className={`flex items-center gap-2 ${
                    isActive ? "bg-accent text-accent-foreground" : ""
                  }`}
                >
                  <Icon size={16} weight="light" />
                  <span>{label}</span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {shortcut}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {trailingTools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive = activeTool === tool;
          return (
            <Button
              key={label}
              onClick={() => toggleTool(tool)}
              title={`${label} (${shortcut})`}
              variant="ghost"
              size="lg"
              className={`${toolButtonBaseClass} ${
                isActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
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
