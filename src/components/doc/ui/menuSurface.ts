import { cn } from "@/lib/utils";

/** Same surface as the app's dropdown menus (ui/dropdown-menu.tsx), for hand-positioned floating elements. */
export const MENU_SURFACE = "bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1";

/** Overrides for a Popover/Input rendered on MENU_SURFACE, so portaled panels match the bubble menu in both themes. */
export const POPOVER_SURFACE = cn(MENU_SURFACE, "border-0 w-auto");
export const MENU_INPUT = "bg-popover-foreground/10 text-popover-foreground placeholder:text-popover-foreground/50";
export const MENU_HOVER = "hover:bg-popover-foreground/10";

/** Bubble-menu button scale, matching the canvas tool bar (PrimitivesPanel): 36px buttons, 20px icons. */
export const BUBBLE_ICON_BUTTON = "size-9 rounded-lg [&_svg]:size-5";

/** A bubble-menu toggle (mark, link): blue when active. */
export function bubbleToggleClass(active: boolean): string {
  return cn(
    BUBBLE_ICON_BUTTON,
    active ? "bg-accent-primary text-white hover:bg-accent-primary/90 hover:text-white" : "text-popover-foreground/70",
  );
}
