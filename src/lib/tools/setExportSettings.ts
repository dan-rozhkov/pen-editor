import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { addExportSetting, createExportSetting } from "@/utils/exportSettingsUtils";
import type { ExportSettingFormat } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

const VALID_FORMATS: ExportSettingFormat[] = ["svg", "png", "jpg", "webp", "pdf"];

/**
 * Add (or replace) an export preset on one or more nodes — this is how the AI
 * "triggers an export with params": since tool execution runs in the
 * browser's local scene graph (no headless renderer/file-download channel
 * back to the model), the tool sets `node.exportSettings` so the user's
 * existing Export UI (`ExportSettingsSection`) can run
 * "Export all" immediately. This keeps the tool client-executed like every
 * other scene mutation and fully unit-testable against the real store.
 */
export const setExportSettings: ToolHandler = async (args) => {
  const nodeIds = args.nodeIds as string[] | undefined;
  const format = args.format as string | undefined;
  const scale = typeof args.scale === "number" ? args.scale : 1;
  const suffix = typeof args.suffix === "string" ? args.suffix : undefined;
  const quality = typeof args.quality === "number" ? args.quality : undefined;
  const mode = args.mode === "replace" ? "replace" : "add";

  if (!nodeIds || nodeIds.length === 0) {
    return JSON.stringify({ error: "nodeIds is required" });
  }
  if (!format || !VALID_FORMATS.includes(format as ExportSettingFormat)) {
    return JSON.stringify({ error: `format must be one of ${VALID_FORMATS.join(", ")}` });
  }

  const history = useHistoryStore.getState();
  history.saveHistory(createSnapshot(useSceneStore.getState()));
  history.startBatch();

  const { nodesById, updateNode } = useSceneStore.getState();
  let updatedCount = 0;
  const missingNodeIds: string[] = [];
  for (const nodeId of nodeIds) {
    const node = nodesById[nodeId];
    if (!node) {
      missingNodeIds.push(nodeId);
      continue;
    }
    const setting = createExportSetting({ format: format as ExportSettingFormat, scale, suffix, quality });
    const nextSettings =
      mode === "replace" ? [setting] : addExportSetting(node.exportSettings, setting);
    updateNode(nodeId, { exportSettings: nextSettings });
    updatedCount += 1;
  }

  history.endBatch();

  // Report the unresolved ids so the model can self-correct instead of assuming
  // every requested node was updated.
  return JSON.stringify(
    missingNodeIds.length > 0
      ? { success: true, updatedCount, missingNodeIds }
      : { success: true, updatedCount },
  );
};
