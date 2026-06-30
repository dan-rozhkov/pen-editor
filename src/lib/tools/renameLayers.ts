import { useSceneStore } from "@/store/sceneStore";
import { saveHistory } from "@/store/sceneStore/helpers/history";
import type { FlatSceneNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

interface RenameEntry {
  id: string;
  name: string;
}

/** Coerce the tool args into a list of {id, name} entries, or null if absent. */
function parseRenames(raw: unknown): RenameEntry[] | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const entries: RenameEntry[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && "id" in item && "name" in item) {
      const { id, name } = item as { id: unknown; name: unknown };
      if (typeof id === "string" && typeof name === "string") {
        entries.push({ id, name });
      }
    }
  }
  return entries;
}

export const renameLayers: ToolHandler = async (args) => {
  const renames = parseRenames(args.renames);
  if (!renames || renames.length === 0) {
    return JSON.stringify({ error: "No renames provided" });
  }

  const state = useSceneStore.getState();
  const newNodesById: Record<string, FlatSceneNode> = { ...state.nodesById };
  const skipped: string[] = [];
  let renamed = 0;

  for (const { id, name } of renames) {
    const existing = newNodesById[id];
    const trimmed = name.trim();
    if (!existing || trimmed.length === 0) {
      skipped.push(id);
      continue;
    }
    newNodesById[id] = { ...existing, name: trimmed };
    renamed += 1;
  }

  if (renamed > 0) {
    // One undo entry for the whole batch (mirrors batch_design's commit pattern).
    saveHistory(state);
    useSceneStore.setState({ nodesById: newNodesById, _cachedTree: null });
  }

  return JSON.stringify({ renamed, skipped });
};
