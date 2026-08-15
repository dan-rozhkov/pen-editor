import { track } from "@/lib/analytics";
import { getToolCommands } from "./toolCommands";
import { getEditCommands } from "./editCommands";
import { getViewCommands } from "./viewCommands";
import { getFileCommands } from "./fileCommands";
import { getPluginCommands } from "./pluginCommands";
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
    ...getPluginCommands(),
  ];
}

// "file-export-<format>" ids (see fileCommands.ts) additionally emit
// `document_exported`, with the format parsed straight from the id.
const FILE_EXPORT_PREFIX = "file-export-";

/**
 * Single dispatch point for running a `PaletteCommand`, used by both the
 * command palette (`CommandPalette.tsx`) and the Electron menu bridge
 * (`desktopBridge.ts`) — the two places a command actually runs. Emits
 * `editor_command_run` for every command, and `document_exported` in
 * addition for file-export commands, so both entry points are covered by a
 * single instrumentation site instead of two.
 */
export function runCommand(command: PaletteCommand): void {
  track("editor_command_run", { command_id: command.id });
  if (command.id.startsWith(FILE_EXPORT_PREFIX)) {
    track("document_exported", { format: command.id.slice(FILE_EXPORT_PREFIX.length) });
  }
  command.run();
}
