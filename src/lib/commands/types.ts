import type { ToolIconComponent } from "@/lib/toolDefinitions";

export type CommandGroupName = "Tools" | "Edit" | "View" | "File" | "Plugins";

export interface PaletteCommand {
  /** Stable, unique identifier (e.g. "tool-rect", "edit-undo"). */
  id: string;
  label: string;
  group: CommandGroupName;
  /** Human-readable shortcut, already platform-formatted (e.g. "⌘Z"). */
  shortcut?: string;
  /** Extra search terms not shown in the UI (e.g. aliases). */
  keywords?: string[];
  icon?: ToolIconComponent;
  /**
   * Marks a command as a scene mutation (delete, group, paste, etc.).
   * The palette filters these out while dev (inspect) mode is active, so
   * the same read-only guarantee `canEditScene`/keyboard shortcuts enforce
   * elsewhere can't be bypassed via ⌘K. Undo/redo are intentionally NOT
   * flagged — they stay available in dev mode (see keyboardCommands.ts).
   */
  mutatesScene?: boolean;
  /** Executes the command. Called on Enter/click; the palette closes after. */
  run: () => void;
}
