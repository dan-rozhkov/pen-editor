import { usePluginStore } from "@/store/pluginStore";
import { deletePlugin, getAllPlugins } from "@/utils/pluginDb";

/**
 * Reset the IndexedDB-backed plugin store to a clean baseline before each
 * test: delete every persisted plugin record and reset the in-memory
 * Zustand store to its un-hydrated initial state. Shared by
 * createPlugin/updatePlugin/listPlugins tests so the reset logic can't drift
 * between the three suites.
 */
export async function resetPluginTestState(): Promise<void> {
  const records = await getAllPlugins();
  await Promise.all(records.map((r) => deletePlugin(r.id)));
  usePluginStore.setState({ plugins: [], hydrated: false });
}
