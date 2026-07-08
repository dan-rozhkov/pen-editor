import { useHistoryStore } from "@/store/historyStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import type { FrameNode, SceneNode } from "@/types/scene";

function applyUpdateRecursive(
  nodeList: SceneNode[],
  id: string,
  changes: Partial<SceneNode>,
): SceneNode[] {
  return nodeList.map((node) => {
    if (node.id === id) {
      return { ...node, ...changes } as SceneNode;
    }
    if (node.type === "frame" || node.type === "group") {
      return {
        ...node,
        children: applyUpdateRecursive(
          (node as FrameNode).children,
          id,
          changes,
        ),
      } as FrameNode;
    }
    return node;
  });
}

/**
 * Save history, apply a batch of position updates, and set nodes — used by
 * align/distribute/tidy-up so the whole batch lands as a single undo step.
 */
export function applyNodeUpdates(
  nodes: SceneNode[],
  updates: { id: string; x?: number; y?: number }[],
) {
  if (updates.length === 0) return;
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  let newNodes = nodes;
  for (const update of updates) {
    const { id, ...changes } = update;
    if (Object.keys(changes).length > 0) {
      newNodes = applyUpdateRecursive(newNodes, id, changes);
    }
  }
  useSceneStore.getState().setNodesWithoutHistory(newNodes);
}
