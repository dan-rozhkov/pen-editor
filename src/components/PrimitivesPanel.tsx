import { CaretDownIcon } from "@/components/icons";
import { Fragment } from "react";
import { useDrawModeStore } from "../store/drawModeStore";
import type { DrawToolType } from "../store/drawModeStore";
import type { ToolDefinition } from "../lib/toolDefinitions";
import {
  EMBED_TOOL,
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
import { ImageOpsTools } from "./canvas/ImageOpsTools";
import { SpeakerNotesCard } from "./SpeakerNotesCard";
import { TOOL_STYLES } from "./toolStyles";
import type { PrimitivesVariant, ToolStyle } from "./toolStyles";
import { CHEVRON_WEIGHT } from "@/components/ui/chevron";

export type { PrimitivesVariant, ToolStyle };

interface ToolDropdownGroupProps {
  mainTool: ToolDefinition;
  onMainClick: () => void;
  isMainActive: boolean;
  subMenuTooltip: string;
  subTools: ToolDefinition[];
  activeTool: DrawToolType | null;
  isSubGroupActive: boolean;
  onToggleTool: (tool: DrawToolType) => void;
  style: ToolStyle;
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
  style,
}: ToolDropdownGroupProps) {
  return (
    <DropdownMenu>
      <div className="flex items-center gap-1">
        <IconButton
          variant="ghost"
          size="lg"
          tooltip={mainTool.label}
          shortcut={mainTool.shortcut}
          side={style.tooltipSide}
          onClick={onMainClick}
          aria-pressed={isMainActive}
          className={`${style.buttonBase} ${isMainActive ? style.active : style.inactive}`}
        >
          <mainTool.icon size={style.iconSize} className={style.icon} weight="light" />
        </IconButton>

        <DropdownMenuTrigger
          render={
            <IconButton
              variant="ghost"
              size="lg"
              tooltip={subMenuTooltip}
              side={style.tooltipSide}
              className={`${style.buttonBase} ${style.caretButton} ${
                isSubGroupActive ? style.active : style.inactive
              }`}
            >
              <CaretDownIcon size={12} className={style.caret} weight={CHEVRON_WEIGHT} />
            </IconButton>
          }
        />
      </div>

      <DropdownMenuContent align="center" sideOffset={style.menuSideOffset}>
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

interface PrimitivesPanelProps {
  /**
   * "floating" (default): the bottom-center card used by the embed widget.
   * "header": compact, card-less row for the canvas header (the parent
   * positions it; this variant renders no absolute wrapper).
   */
  variant?: PrimitivesVariant;
}

export function PrimitivesPanel({ variant = "floating" }: PrimitivesPanelProps = {}) {
  const activeTool = useDrawModeStore((s) => s.activeTool);
  const toggleTool = useDrawModeStore((s) => s.toggleTool);
  const setActiveTool = useDrawModeStore((s) => s.setActiveTool);

  const trailingTools = TRAILING_TOOLS;
  const rectSubTools = RECT_SUB_TOOLS;
  const penSubTools = PEN_SUB_TOOLS;

  const isMoveSubToolActive = MOVE_SUB_TOOLS.some((t) => t.tool === activeTool);
  const isMoveActive = activeTool === null;
  const isEmbedActive = activeTool === "embed";
  const isRectSubToolActive = rectSubTools.some((t) => t.tool === activeTool);
  const isRectangleActive = activeTool === "rect";
  const isPenSubToolActive = penSubTools.some((t) => t.tool === activeTool);
  const isPenActive = activeTool === "pen";
  const compact = variant === "header";
  const style = TOOL_STYLES[variant];
  const buttonClass = (isActive: boolean) =>
    `${style.buttonBase} ${isActive ? style.active : style.inactive}`;

  const tools = (
    <>
      <ToolDropdownGroup
        mainTool={MOVE_TOOL}
        onMainClick={() => setActiveTool(null)}
        isMainActive={isMoveActive}
        subMenuTooltip="More move tools"
        subTools={MOVE_SUB_TOOLS}
        activeTool={activeTool}
        isSubGroupActive={isMoveSubToolActive}
        onToggleTool={toggleTool}
        style={style}
      />

      <IconButton
        onClick={() => toggleTool(EMBED_TOOL.tool)}
        tooltip={EMBED_TOOL.label}
        shortcut={EMBED_TOOL.shortcut}
        side={style.tooltipSide}
        variant="ghost"
        size="lg"
        aria-pressed={isEmbedActive}
        className={buttonClass(isEmbedActive)}
      >
        <EMBED_TOOL.icon size={style.iconSize} className={style.icon} weight="light" />
      </IconButton>

      <ToolDropdownGroup
        mainTool={RECT_TOOL}
        onMainClick={() => toggleTool("rect")}
        isMainActive={isRectangleActive}
        subMenuTooltip="More shapes"
        subTools={rectSubTools}
        activeTool={activeTool}
        isSubGroupActive={isRectSubToolActive}
        onToggleTool={toggleTool}
        style={style}
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
        style={style}
      />

      <IconButton
        onClick={() => toggleTool(COMMENT_TOOL.tool)}
        tooltip={COMMENT_TOOL.label}
        shortcut={COMMENT_TOOL.shortcut}
        side={style.tooltipSide}
        variant="ghost"
        size="lg"
        aria-pressed={activeTool === COMMENT_TOOL.tool}
        className={buttonClass(activeTool === COMMENT_TOOL.tool)}
      >
        <COMMENT_TOOL.icon size={style.iconSize} className={style.icon} weight="light" />
      </IconButton>

      {trailingTools.map(({ icon: Icon, label, tool, shortcut }) => {
        const isActive = activeTool === tool;
        return (
          <Fragment key={label}>
            <IconButton
              onClick={() => toggleTool(tool)}
              tooltip={label}
              shortcut={shortcut}
              side={style.tooltipSide}
              variant="ghost"
              size="lg"
              aria-pressed={isActive}
              className={buttonClass(isActive)}
            >
              <Icon size={style.iconSize} className={style.icon} weight="light" />
            </IconButton>
          </Fragment>
        );
      })}

      <Separator
        orientation="vertical"
        className={compact ? "mx-1 h-4" : "mx-2 h-6"}
        style={{ alignSelf: "center" }}
      />
      <Layers3DToggle toolStyle={style} />
      <ImageOpsTools toolStyle={style} />
      <SpeakerNotesCard toolStyle={style} />
    </>
  );

  if (compact) {
    return (
      <div data-testid="primitives-panel" className="flex items-center gap-2">
        {tools}
      </div>
    );
  }

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2">
      <div className="flex items-center gap-2 p-1.5 bg-surface-panel border border-border-default rounded-2xl shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
        {tools}
      </div>
    </div>
  );
}
