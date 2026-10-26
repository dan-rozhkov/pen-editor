export type PrimitivesVariant = "floating" | "header";

/**
 * Per-variant look of the drawing-tool buttons. "floating" is the embed
 * widget's bottom card (36px buttons, 24px icons); "header" is the compact row
 * in the canvas header (28px buttons, 16px icons, no card). PrimitivesPanel and
 * the contextual extras it hosts (Layers3DToggle, ImageOpsTools,
 * SpeakerNotesCard) all read this one definition.
 */
export interface ToolStyle {
  buttonBase: string;
  active: string;
  inactive: string;
  icon: string;
  iconSize: number;
  caret: string;
  caretButton: string;
  tooltipSide: "top" | "bottom";
  menuSideOffset: number;
}

// The selected tool is accent-filled in both variants, so it never looks like a hovered one.
const ACTIVE = "bg-accent-light text-white hover:bg-accent-light hover:text-white";
// Same hover as the ghost Button variant, spelled out because Layers3DToggle is a
// plain <button> with no Button classes.
const INACTIVE = "text-text-primary hover:text-text-primary hover:bg-secondary dark:hover:bg-surface-hover";

export const TOOL_STYLES: Record<PrimitivesVariant, ToolStyle> = {
  floating: {
    buttonBase: "group relative size-9 p-0 rounded-control-xl! transition-none outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    active: ACTIVE,
    inactive: INACTIVE,
    icon: "size-6",
    iconSize: 24,
    caret: "size-3",
    caretButton: "-ml-1 w-6 justify-center",
    tooltipSide: "top",
    menuSideOffset: 8,
  },
  header: {
    buttonBase: "group relative size-7 p-0 rounded-control transition-none outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
    active: ACTIVE,
    inactive: INACTIVE,
    icon: "size-4",
    iconSize: 16,
    caret: "size-3",
    caretButton: "-ml-1 w-4 justify-center",
    tooltipSide: "bottom",
    menuSideOffset: 6,
  },
};
