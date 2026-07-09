import { useDrawModeStore } from "@/store/drawModeStore";
import { ALL_TOOLS } from "@/lib/toolDefinitions";
import type { PaletteCommand } from "./types";

/**
 * One command per entry in `ALL_TOOLS` — the same list `PrimitivesPanel`
 * renders, so the palette can never list a tool the toolbar doesn't have
 * (or vice versa). "Select" (the `cursor` pseudo-tool) clears the active
 * tool instead of toggling it, matching the toolbar's own Select button.
 */
export function getToolCommands(): PaletteCommand[] {
  return ALL_TOOLS.map((def) => ({
    id: `tool-${def.tool}`,
    label: def.label,
    group: "Tools",
    shortcut: def.shortcut,
    icon: def.icon,
    run: () => {
      if (def.tool === "cursor") {
        useDrawModeStore.getState().setActiveTool(null);
      } else {
        useDrawModeStore.getState().toggleTool(def.tool);
      }
    },
  }));
}
