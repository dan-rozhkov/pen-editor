import { cn } from "@/lib/utils";

/** Same surface as the app's dropdown menus (ui/dropdown-menu.tsx), for hand-positioned floating elements. */
export const MENU_SURFACE = "bg-popover text-popover-foreground ring-foreground/10 rounded-lg shadow-md ring-1";

/** Overrides for a Popover/Input rendered on MENU_SURFACE, so portaled panels match the bubble menu in both themes. */
export const POPOVER_SURFACE = cn(MENU_SURFACE, "border-0 w-auto");
export const MENU_INPUT = "bg-popover-foreground/10 text-popover-foreground placeholder:text-popover-foreground/50";
export const MENU_HOVER = "hover:bg-popover-foreground/10";
