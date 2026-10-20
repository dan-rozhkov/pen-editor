import { cn } from "@/lib/utils";

/** Same surface as the app's dropdown menus (ui/dropdown-menu.tsx), for hand-positioned floating elements. */
export const MENU_SURFACE = "bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1";

/** Overrides for a Popover/Input rendered on MENU_SURFACE, so portaled panels match the bubble menu in both themes. */
export const POPOVER_SURFACE = cn(MENU_SURFACE, "border-0 w-auto");
export const MENU_INPUT = "bg-popover-foreground/10 text-popover-foreground placeholder:text-popover-foreground/50";
/** The dropdown-menu item highlight (ui/dropdown-menu.tsx), for hand-built rows on MENU_SURFACE. */
export const MENU_HOVER = "hover:bg-accent hover:text-accent-foreground";

/**
 * MENU_HOVER for a ghost Button on MENU_SURFACE, open state included. The ghost variant's own hover is
 * bg-secondary, near-white in the light theme, on this always-dark surface.
 */
export const BUBBLE_HOVER = cn(
  MENU_HOVER,
  "dark:hover:bg-accent aria-expanded:bg-accent aria-expanded:text-accent-foreground",
);

/** Bubble-menu button scale, matching the canvas tool bar (PrimitivesPanel): 36px buttons, 20px icons. */
export const BUBBLE_ICON_BUTTON = "size-9 rounded-lg [&_svg]:size-5";

/** A bubble-menu toggle (mark, link): blue when active. */
export function bubbleToggleClass(active: boolean): string {
  return cn(
    BUBBLE_ICON_BUTTON,
    active
      ? "bg-accent-primary text-white hover:bg-accent-primary/90 hover:text-white dark:hover:bg-accent-primary/90 aria-expanded:bg-accent-primary aria-expanded:text-white"
      : cn(BUBBLE_HOVER, "text-popover-foreground/70"),
  );
}
