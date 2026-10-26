import { cn } from "@/lib/utils";

/** Same theme-following surface as the app's dropdown menus (ui/dropdown-menu.tsx), for hand-positioned floating elements. */
export const MENU_SURFACE = "menu-surface";

/** Overrides for a Popover/Input rendered on MENU_SURFACE, so portaled panels match the bubble menu in both themes. */
export const POPOVER_SURFACE = cn(MENU_SURFACE, "border-0 w-auto");
export const MENU_INPUT = "bg-menu-highlight text-menu-foreground placeholder:text-menu-muted-foreground";
/** The dropdown-menu item highlight (ui/dropdown-menu.tsx), for hand-built rows on MENU_SURFACE. */
export const MENU_HOVER = "hover:bg-menu-highlight hover:text-menu-foreground";

/**
 * MENU_HOVER for a ghost Button on MENU_SURFACE, open state included. The ghost variant's own dark-theme hover
 * (dark:hover:bg-muted/50) would otherwise win over the menu highlight, so it is overridden explicitly.
 */
export const BUBBLE_HOVER = cn(
  MENU_HOVER,
  "dark:hover:bg-menu-highlight aria-expanded:bg-menu-highlight aria-expanded:text-menu-foreground",
);

/** Bubble-menu button scale, matching the canvas tool bar (PrimitivesPanel): 36px buttons, 20px icons. */
export const BUBBLE_ICON_BUTTON = "size-9 rounded-control-xl [&_svg]:size-5";

/** A bubble-menu toggle (mark, link): blue when active. */
export function bubbleToggleClass(active: boolean): string {
  return cn(
    BUBBLE_ICON_BUTTON,
    active
      ? "bg-accent-primary text-white hover:bg-accent-primary/90 hover:text-white dark:hover:bg-accent-primary/90 aria-expanded:bg-accent-primary aria-expanded:text-white"
      : cn(BUBBLE_HOVER, "text-menu-foreground/70"),
  );
}
