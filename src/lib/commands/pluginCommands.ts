import { usePluginStore } from "@/store/pluginStore";
import { usePluginManagerStore } from "@/store/pluginManagerStore";
import { runPlugin } from "@/lib/plugins/pluginHost";
import type { PaletteCommand } from "./types";

/**
 * One command per installed plugin (runs it — flagged `mutatesScene` since a
 * plugin can call scene-mutating tools, so it's hidden in dev/inspect mode
 * like every other mutating command) plus a "Manage plugins…" entry that
 * opens the manager panel (`pluginManagerStore`).
 */
export function getPluginCommands(): PaletteCommand[] {
  const plugins = usePluginStore.getState().plugins;

  const runCommands: PaletteCommand[] = plugins.map((plugin) => ({
    id: `plugin-${plugin.id}`,
    label: plugin.icon ? `${plugin.icon} ${plugin.name}` : plugin.name,
    group: "Plugins",
    keywords: ["plugin", plugin.description].filter(Boolean),
    mutatesScene: true,
    run: () => {
      runPlugin(plugin);
    },
  }));

  const manageCommand: PaletteCommand = {
    id: "plugins-manage",
    label: "Manage plugins…",
    group: "Plugins",
    keywords: ["plugins", "manager", "install", "import", "export"],
    run: () => usePluginManagerStore.getState().setOpen(true),
  };

  return [...runCommands, manageCommand];
}
