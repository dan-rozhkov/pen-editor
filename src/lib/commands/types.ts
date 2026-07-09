import type { ToolIconComponent } from "@/lib/toolDefinitions";

export type CommandGroupName = "Tools" | "Edit" | "View" | "File";

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
  /** Executes the command. Called on Enter/click; the palette closes after. */
  run: () => void;
}
