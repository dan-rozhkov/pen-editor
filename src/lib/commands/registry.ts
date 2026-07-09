import { getToolCommands } from "./toolCommands";
import { getEditCommands } from "./editCommands";
import { getViewCommands } from "./viewCommands";
import { getFileCommands } from "./fileCommands";
import type { PaletteCommand } from "./types";

export type { PaletteCommand, CommandGroupName } from "./types";
export { commandFilter } from "./filter";

/**
 * Full command list for the palette: tools + edit + view + file actions,
 * each group sourced from the same store methods / event bus the toolbar,
 * keyboard shortcuts, and context menu already use (see the per-group
 * modules for the specific reuse points). Rebuilt on each call — cheap
 * (~30 plain objects) and keeps closures fresh without a memoization bug
 * surface.
 */
export function getCommands(): PaletteCommand[] {
  return [
    ...getToolCommands(),
    ...getEditCommands(),
    ...getViewCommands(),
    ...getFileCommands(),
  ];
}
