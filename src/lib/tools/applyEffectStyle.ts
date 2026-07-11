import { useStyleStore } from "@/store/styleStore";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import type { ToolHandler } from "../toolRegistry";

/** Bind one or more nodes' effect stack (shadows/blur) to a named effect style. */
export const applyEffectStyle: ToolHandler = async (args) => {
  const nodeIds = args.nodeIds as string[] | undefined;
  const styleId = args.styleId as string | undefined;

  if (!nodeIds || nodeIds.length === 0) {
    return JSON.stringify({ error: "nodeIds is required" });
  }
  if (!styleId) {
    return JSON.stringify({ error: "styleId is required" });
  }

  const store = useStyleStore.getState();
  const style = store.effectStyles.find((s) => s.id === styleId);
  if (!style) {
    return JSON.stringify({ error: `Effect style '${styleId}' not found` });
  }

  // One tool call = one undo step, even across many nodes (mirrors setStyles.ts).
  const history = useHistoryStore.getState();
  history.saveHistory(createSnapshot(useSceneStore.getState()));

  let appliedCount = 0;
  withHistoryBatch(() => {
    const nodesById = useSceneStore.getState().nodesById;
    for (const nodeId of nodeIds) {
      if (!nodesById[nodeId]) continue;
      store.applyEffectStyleToNode(nodeId, styleId);
      appliedCount += 1;
    }
  });

  return JSON.stringify({ success: true, appliedCount });
};
