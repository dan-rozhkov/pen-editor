import { PluginKey, type EditorState } from "@tiptap/pm/state";

/** Kept apart from SlashCommand.ts so headless extensions can ask "is the menu open?" without the React menu. */
export const SlashCommandKey = new PluginKey("slashCommand");

export function isSlashActive(state: EditorState): boolean {
  return !!(SlashCommandKey.getState(state) as { active?: boolean } | undefined)?.active;
}
