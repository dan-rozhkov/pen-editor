import {
  SquareIcon,
  CircleIcon,
  TextTIcon,
  NavigationArrowIcon,
  LineSegmentIcon,
  HexagonIcon,
  HashStraight,
  type IconWeight,
  CaretDownIcon,
  SparkleIcon,
  CodeIcon,
} from "@phosphor-icons/react";
import { useDrawModeStore, type DrawToolType } from "../store/drawModeStore";
import { useChatStore } from "../store/chatStore";
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
  const { isOpen: isChatOpen, toggleOpen: toggleChat } = useChatStore();

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
    { icon: CircleIcon, label: "Ellipse", tool: "ellipse", shortcut: "O" },
    { icon: TextTIcon, label: "Text", tool: "text", shortcut: "T" },
    { icon: CodeIcon, label: "Embed", tool: "embed", shortcut: "E" },
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
  ];

  const isRectSubToolActive = rectSubTools.some((t) => t.tool === activeTool);
  const isRectangleActive = activeTool === "rect";
  const toolButtonBaseClass =
    "group relative size-9 p-0 rounded-lg transition-none outline-none";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-2 bg-surface-panel/95 backdrop-blur-sm border border-border-default rounded-2xl shadow-lg">
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
                  ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
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
                  ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
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
                    ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
                    : "text-text-primary hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
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
                  ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
              }`}
            >
              <Icon size={40} className="size-6" weight="light" />
            </Button>
          );
        })}

        <div className="w-px h-5 bg-border-default mx-0.5" />

        <Button
          onClick={toggleChat}
          title="Design Agent"
          variant="ghost"
          size="lg"
          className={`${toolButtonBaseClass} ${
            isChatOpen
              ? "bg-[#0d99ff] text-white hover:bg-[#0d99ff] hover:text-white"
              : "text-text-primary hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover"
          }`}
        >
          <SparkleIcon size={40} className="size-6" weight="light" />
        </Button>
      </div>
    </div>
  );
}
