import { useTextStyleStore } from "@/store/textStyleStore";
import { useSceneStore } from "@/store/sceneStore";
import type { ToolHandler } from "../toolRegistry";

export const applyTextStyle: ToolHandler = async (args) => {
  const nodeIds = args.nodeIds as string[] | undefined;
  const textStyleId = args.textStyleId as string | undefined;

  if (!nodeIds || nodeIds.length === 0) {
    return JSON.stringify({ error: "nodeIds is required" });
  }
  if (!textStyleId) {
    return JSON.stringify({ error: "textStyleId is required" });
  }

  const store = useTextStyleStore.getState();
  const style = store.textStyles.find((s) => s.id === textStyleId);
  if (!style) {
    return JSON.stringify({ error: `Text style '${textStyleId}' not found` });
  }

  let appliedCount = 0;
  const nodesById = useSceneStore.getState().nodesById;
  for (const nodeId of nodeIds) {
    const node = nodesById[nodeId];
    if (!node || node.type !== "text") continue;
    store.applyStyleToNode(nodeId, textStyleId);
    appliedCount += 1;
  }

  return JSON.stringify({ success: true, appliedCount });
};
