import { CaretDownIcon } from "@phosphor-icons/react";
import { Fragment } from "react";
import { useDrawModeStore } from "../store/drawModeStore";
import {
  LEADING_TOOLS,
  MOVE_TOOL,
  MOVE_SUB_TOOLS,
  RECT_TOOL,
  RECT_SUB_TOOLS,
  PEN_TOOL,
  PEN_SUB_TOOLS,
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

export function PrimitivesPanel() {
  const { activeTool, toggleTool, setActiveTool } = useDrawModeStore();

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
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-1 p-1.5 bg-surface-panel border border-border-default rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
        <DropdownMenu>
          <div className="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="lg"
              tooltip={MOVE_TOOL.label}
              shortcut={MOVE_TOOL.shortcut}
              side="top"
              onClick={() => setActiveTool(null)}
              className={`${toolButtonBaseClass} ${
                isMoveActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <MOVE_TOOL.icon size={40} className="size-6" weight="light" />
            </IconButton>

            <DropdownMenuTrigger
              render={
                <IconButton
                  variant="ghost"
                  size="lg"
                  tooltip="More move tools"
                  side="top"
                  className={`${toolButtonBaseClass} w-6 justify-center ${
                    isMoveSubToolActive
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
            {MOVE_SUB_TOOLS.map(({ icon: Icon, label, tool, shortcut }) => {
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

        <DropdownMenu>
          <div className="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="lg"
              tooltip={RECT_TOOL.label}
              shortcut={RECT_TOOL.shortcut}
              side="top"
              onClick={() => toggleTool("rect")}
              className={`${toolButtonBaseClass} ${
                isRectangleActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <RECT_TOOL.icon size={40} className="size-6" weight="light" />
            </IconButton>

            <DropdownMenuTrigger
              render={
                <IconButton
                  variant="ghost"
                  size="lg"
                  tooltip="More shapes"
                  side="top"
                  className={`${toolButtonBaseClass} w-6 justify-center ${
                    isRectSubToolActive
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

        <DropdownMenu>
          <div className="flex items-center gap-1">
            <IconButton
              variant="ghost"
              size="lg"
              tooltip={PEN_TOOL.label}
              shortcut={PEN_TOOL.shortcut}
              side="top"
              onClick={() => toggleTool("pen")}
              className={`${toolButtonBaseClass} ${
                isPenActive
                  ? "bg-accent-light text-white hover:bg-accent-light hover:text-white"
                  : "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-secondary"
              }`}
            >
              <PEN_TOOL.icon size={40} className="size-6" weight="light" />
            </IconButton>

            <DropdownMenuTrigger
              render={
                <IconButton
                  variant="ghost"
                  size="lg"
                  tooltip="More pen tools"
                  side="top"
                  className={`${toolButtonBaseClass} w-6 justify-center ${
                    isPenSubToolActive
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
            {penSubTools.map(({ icon: Icon, label, tool, shortcut }) => {
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
      </div>
    </div>
  );
}
