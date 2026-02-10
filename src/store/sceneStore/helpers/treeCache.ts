import type { SceneNode, FlatSceneNode } from "../../../types/scene";
import { buildTree } from "../../../types/scene";

// ----- Module-level tree cache (avoids setState in selectors) -----
let _treeCacheRef: {
  nodesById: Record<string, FlatSceneNode>;
  rootIds: string[];
  childrenById: Record<string, string[]>;
  tree: SceneNode[];
} | null = null;

export function getCachedTree(state: {
  nodesById: Record<string, FlatSceneNode>;
  rootIds: string[];
  childrenById: Record<string, string[]>;
}): SceneNode[] {
  if (
    _treeCacheRef &&
    _treeCacheRef.nodesById === state.nodesById &&
    _treeCacheRef.rootIds === state.rootIds &&
    _treeCacheRef.childrenById === state.childrenById
  ) {
    return _treeCacheRef.tree;
  }
  const tree = buildTree(state.rootIds, state.nodesById, state.childrenById);
  _treeCacheRef = {
    nodesById: state.nodesById,
    rootIds: state.rootIds,
    childrenById: state.childrenById,
    tree,
  };
  return tree;
}
