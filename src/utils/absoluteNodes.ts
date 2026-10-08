import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import type { SceneNode } from "@/types/scene";

/**
 * Resolve ids to synthetic root-level nodes carrying ABSOLUTE x/y, suitable
 * for `fitToContent`/`calculateNodesBounds`, which treat top-level array
 * entries as canvas-absolute. `nodesById` entries are parent-relative.
 */
export function resolveAbsoluteNodes(ids: Iterable<string>): SceneNode[] {
  const { nodesById, getNodes } = useSceneStore.getState();
  const tree = getNodes();
  const calc = useLayoutStore.getState().calculateLayoutForFrame;
  const resolved: SceneNode[] = [];
  for (const id of ids) {
    const node = nodesById[id];
    if (!node) continue;
    const abs = getNodeAbsolutePositionWithLayout(tree, id, calc);
    if (!abs) continue;
    resolved.push({ ...node, x: abs.x, y: abs.y, children: [] } as SceneNode);
  }
  return resolved;
}
