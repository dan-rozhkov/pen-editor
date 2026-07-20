import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { createSnapshot } from "@/store/sceneStore/helpers/history";

/**
 * Shared body for `applyFillStyle`/`applyEffectStyle`: validate `nodeIds`/`styleId`,
 * look up the style, snapshot history once, then apply it to every existing node
 * inside a single history batch (one tool call = one undo step, even across many nodes).
 */
export async function applyStyleToNodes(
  args: Record<string, unknown>,
  styleLabel: string,
  findStyle: (styleId: string) => unknown,
  applyToNode: (nodeId: string, styleId: string) => void,
): Promise<string> {
  const nodeIds = args.nodeIds as string[] | undefined;
  const styleId = args.styleId as string | undefined;

  if (!nodeIds || nodeIds.length === 0) {
    return JSON.stringify({ error: "nodeIds is required" });
  }
  if (!styleId) {
    return JSON.stringify({ error: "styleId is required" });
  }

  const style = findStyle(styleId);
  if (!style) {
    return JSON.stringify({ error: `${styleLabel} '${styleId}' not found` });
  }

  const history = useHistoryStore.getState();
  history.saveHistory(createSnapshot(useSceneStore.getState()));

  let appliedCount = 0;
  withHistoryBatch(() => {
    const nodesById = useSceneStore.getState().nodesById;
    for (const nodeId of nodeIds) {
      if (!nodesById[nodeId]) continue;
      applyToNode(nodeId, styleId);
      appliedCount += 1;
    }
  });

  return JSON.stringify({ success: true, appliedCount });
}
