import { usePluginStore } from "@/store/pluginStore";
import type { ToolHandler } from "../../toolRegistry";

/**
 * list_plugins — compact `{id, name, description}` listing of installed
 * plugins, so the agent can find a target id before calling `update_plugin`.
 */
export const listPlugins: ToolHandler = async () => {
  const store = usePluginStore.getState();
  await store.init();
  const plugins = usePluginStore.getState().plugins;

  if (plugins.length === 0) return "no plugins installed";

  return JSON.stringify(
    plugins.map((p) => ({ id: p.id, name: p.name, description: p.description })),
  );
};
