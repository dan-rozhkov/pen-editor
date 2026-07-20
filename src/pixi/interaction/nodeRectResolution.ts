import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";
import type { FlatSceneNode } from "@/types/scene";

export interface ResolvedNodePosition {
  node: FlatSceneNode;
  pos: { x: number; y: number };
  size: { width: number; height: number } | null;
}

/** Resolve a node's absolute position and effective (layout-aware) size. Null if unresolvable. */
export function resolveNodeAbsolutePosition(nodeId: string): ResolvedNodePosition | null {
  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const nodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const pos = getNodeAbsolutePositionWithLayout(nodes, nodeId, calculateLayoutForFrame);
  if (!pos) return null;
  const size = getNodeEffectiveSize(nodes, nodeId, calculateLayoutForFrame);
  return { node, pos, size };
}
