import { CaretDownIcon } from "@phosphor-icons/react";
import { Fragment } from "react";
import { useDrawModeStore } from "../store/drawModeStore";
import type { DrawToolType } from "../store/drawModeStore";
import type { ToolDefinition } from "../lib/toolDefinitions";
import {
  LEADING_TOOLS,
  MOVE_TOOL,
  MOVE_SUB_TOOLS,
  RECT_TOOL,
  RECT_SUB_TOOLS,
  PEN_TOOL,
  PEN_SUB_TOOLS,
  COMMENT_TOOL,
  TRAILING_TOOLS,
} from "../lib/toolDefinitions";
import { IconButton } from "./ui/IconButton";
import { Separator } from "./ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Layers3DToggle } from "./canvas/Layers3DToggle";
import { SpeakerNotesCard } from "./SpeakerNotesCard";

interface ToolDropdownGroupProps {
  mainTool: ToolDefinition;
  onMainClick: () => void;
  isMainActive: boolean;
  subMenuTooltip: string;
  subTools: ToolDefinition[];
  activeTool: DrawToolType | null;
  isSubGroupActive: boolean;
  onToggleTool: (tool: DrawToolType) => void;
  toolButtonBaseClass: string;
}

function ToolDropdownGroup({
  mainTool,
  onMainClick,
  isMainActive,
  subMenuTooltip,
  subTools,
  activeTool,
  isSubGroupActive,
  onToggleTool,
  toolButtonBaseClass,
}: ToolDropdownGroupProps) {
  return (
    <DropdownMenu>
      <div className="flex items-center gap-1">
        <IconButton
          variant="ghost"
          size="lg"
          tooltip={mainTool.label}
          shortcut={mainTool.shortcut}
          side="top"
          onClick={onMainClick}
          className={`${toolButtonBaseClass} ${
            isMainActive
              ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
              : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
          }`}
        >
          <mainTool.icon size={40} className="size-6" weight="light" />
        </IconButton>

        <DropdownMenuTrigger
          render={
            <IconButton
              variant="ghost"
              size="lg"
              tooltip={subMenuTooltip}
              side="top"
              className={`${toolButtonBaseClass} -ml-1 w-6 justify-center ${
                isSubGroupActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <CaretDownIcon size={12} className="size-3" weight="bold" />
            </IconButton>
          }
        />
      </div>

      <DropdownMenuContent align="center" sideOffset={8}>
        {subTools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive = activeTool === tool;
          return (
            <DropdownMenuItem
              key={label}
              onClick={() => onToggleTool(tool)}
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
  );
}

export function PrimitivesPanel() {
  const activeTool = useDrawModeStore((s) => s.activeTool);
  const toggleTool = useDrawModeStore((s) => s.toggleTool);
  const setActiveTool = useDrawModeStore((s) => s.setActiveTool);

  const leadingTools = LEADING_TOOLS;
  const trailingTools = TRAILING_TOOLS;
  const rectSubTools = RECT_SUB_TOOLS;
  const penSubTools = PEN_SUB_TOOLS;

  const isMoveSubToolActive = MOVE_SUB_TOOLS.some((t) => t.tool === activeTool);
  const isMoveActive = activeTool === null;
  const isRectSubToolActive = rectSubTools.some((t) => t.tool === activeTool);
  const isRectangleActive = activeTool === "rect";
  const isPenSubToolActive = penSubTools.some((t) => t.tool === activeTool);
  const isPenActive = activeTool === "pen";
  const toolButtonBaseClass =
    "group relative size-9 p-0 rounded-lg! transition-none outline-none";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      <div className="flex items-center gap-1 p-1.5 bg-surface-panel border border-border-default rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
        <ToolDropdownGroup
          mainTool={MOVE_TOOL}
          onMainClick={() => setActiveTool(null)}
          isMainActive={isMoveActive}
          subMenuTooltip="More move tools"
          subTools={MOVE_SUB_TOOLS}
          activeTool={activeTool}
          isSubGroupActive={isMoveSubToolActive}
          onToggleTool={toggleTool}
          toolButtonBaseClass={toolButtonBaseClass}
        />

        {leadingTools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive =
            tool === "cursor" ? activeTool === null : activeTool === tool;
          return (
            <IconButton
              key={label}
              onClick={() =>
                tool === "cursor" ? setActiveTool(null) : toggleTool(tool)
              }
              tooltip={label}
              shortcut={shortcut}
              side="top"
              variant="ghost"
              size="lg"
              className={`${toolButtonBaseClass} ${
                isActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <Icon size={40} className="size-6" weight="light" />
            </IconButton>
          );
        })}

        <ToolDropdownGroup
          mainTool={RECT_TOOL}
          onMainClick={() => toggleTool("rect")}
          isMainActive={isRectangleActive}
          subMenuTooltip="More shapes"
          subTools={rectSubTools}
          activeTool={activeTool}
          isSubGroupActive={isRectSubToolActive}
          onToggleTool={toggleTool}
          toolButtonBaseClass={toolButtonBaseClass}
        />

        <ToolDropdownGroup
          mainTool={PEN_TOOL}
          onMainClick={() => toggleTool("pen")}
          isMainActive={isPenActive}
          subMenuTooltip="More pen tools"
          subTools={penSubTools}
          activeTool={activeTool}
          isSubGroupActive={isPenSubToolActive}
          onToggleTool={toggleTool}
          toolButtonBaseClass={toolButtonBaseClass}
        />

        <IconButton
          onClick={() => toggleTool(COMMENT_TOOL.tool)}
          tooltip={COMMENT_TOOL.label}
          shortcut={COMMENT_TOOL.shortcut}
          side="top"
          variant="ghost"
          size="lg"
          className={`${toolButtonBaseClass} ${
            activeTool === COMMENT_TOOL.tool
              ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
              : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
          }`}
        >
          <COMMENT_TOOL.icon size={40} className="size-6" weight="light" />
        </IconButton>

        {trailingTools.map(({ icon: Icon, label, tool, shortcut }) => {
          const isActive = activeTool === tool;
          return (
            <Fragment key={label}>
              <IconButton
                onClick={() => toggleTool(tool)}
                tooltip={label}
                shortcut={shortcut}
                side="top"
                variant="ghost"
                size="lg"
                className={`${toolButtonBaseClass} ${
                  isActive
                    ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                    : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
                }`}
              >
                <Icon size={40} className="size-6" weight="light" />
              </IconButton>
            </Fragment>
          );
        })}

        <Separator
          orientation="vertical"
          className="mx-2 h-6"
          style={{ alignSelf: "center" }}
        />
        <Layers3DToggle />
        <SpeakerNotesCard />
      </div>
    </div>
  );
}
