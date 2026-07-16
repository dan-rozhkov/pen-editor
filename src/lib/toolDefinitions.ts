import {
  SquareIcon,
  CircleIcon,
  TextTIcon,
  NavigationArrowIcon,
  LineSegmentIcon,
  HexagonIcon,
  StarIcon,
  HashStraight,
  PencilSimple,
  PenNibIcon,
  FlowArrow,
  type IconWeight,
  CodeBlockIcon,
  ResizeIcon,
  ChatCircleIcon,
} from "@phosphor-icons/react";
import { TextOnPathIcon } from "@/components/ui/custom-icons/TextOnPathIcon";
import type { DrawToolType } from "@/store/drawModeStore";

export type ToolIconComponent = React.ComponentType<{
  className?: string;
  size?: number;
  weight?: IconWeight;
}>;

export interface ToolDefinition {
  icon: ToolIconComponent;
  label: string;
  tool: DrawToolType;
  shortcut: string;
}

/**
 * Single source of truth for every drawing/selection tool: icon, label,
 * `DrawToolType` id, and displayed keyboard shortcut. `PrimitivesPanel`
 * (the bottom toolbar) and the command palette (`CommandPalette`) both
 * render from these lists instead of maintaining their own copies, so the
 * tool set and its shortcuts can't drift between the two surfaces.
 */
export const LEADING_TOOLS: ToolDefinition[] = [
  { icon: HashStraight, label: "Frame", tool: "frame", shortcut: "F" },
];

export const MOVE_TOOL: ToolDefinition = {
  icon: NavigationArrowIcon,
  label: "Move",
  tool: "cursor",
  shortcut: "V",
};

export const MOVE_SUB_TOOLS: ToolDefinition[] = [
  { icon: ResizeIcon, label: "Scale", tool: "scale", shortcut: "K" },
];

export const RECT_TOOL: ToolDefinition = {
  icon: SquareIcon,
  label: "Rectangle",
  tool: "rect",
  shortcut: "R",
};

export const RECT_SUB_TOOLS: ToolDefinition[] = [
  { icon: CircleIcon, label: "Ellipse", tool: "ellipse", shortcut: "O" },
  { icon: LineSegmentIcon, label: "Line", tool: "line", shortcut: "L" },
  { icon: HexagonIcon, label: "Polygon", tool: "polygon", shortcut: "G" },
  { icon: StarIcon, label: "Star", tool: "star", shortcut: "S" },
  { icon: FlowArrow, label: "Connector", tool: "connector", shortcut: "C" },
];

export const PEN_TOOL: ToolDefinition = {
  icon: PenNibIcon,
  label: "Pen",
  tool: "pen",
  shortcut: "P",
};

export const PEN_SUB_TOOLS: ToolDefinition[] = [
  { icon: PencilSimple, label: "Pencil", tool: "pencil", shortcut: "D" },
  // Click a vector path on canvas to convert it into text-on-a-path (fill
  // and effects migrate onto the new text layer; no source path node
  // remains). See src/pixi/interaction/textPathController.ts.
  { icon: TextOnPathIcon, label: "Text on Path", tool: "text-path", shortcut: "⇧T" },
];

export const COMMENT_TOOL: ToolDefinition = {
  icon: ChatCircleIcon,
  label: "Comment",
  tool: "comment",
  shortcut: "C",
};

export const TRAILING_TOOLS: ToolDefinition[] = [
  { icon: TextTIcon, label: "Text", tool: "text", shortcut: "T" },
  { icon: CodeBlockIcon, label: "Embed", tool: "embed", shortcut: "E" },
];

/** Every tool, flattened into a single list (used by the command palette). */
export const ALL_TOOLS: ToolDefinition[] = [
  MOVE_TOOL,
  ...MOVE_SUB_TOOLS,
  ...LEADING_TOOLS,
  RECT_TOOL,
  ...RECT_SUB_TOOLS,
  PEN_TOOL,
  ...PEN_SUB_TOOLS,
  COMMENT_TOOL,
  ...TRAILING_TOOLS,
];
