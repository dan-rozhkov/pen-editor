import type {
  FlatSceneNode,
  FrameNode,
  RefNode,
  SceneNode,
} from "@/types/scene";
import { buildTree, generateId, isContainerNode } from "@/types/scene";
import {
  getResolvedInstanceSnapshot,
  type ResolvedInstanceSnapshot,
} from "@/utils/instanceSnapshotCache";
import { getAbsolutePositionFlat, getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";

export interface ResolvedDescendant {
  path: string;
  node: SceneNode;
}

export interface ResolvedInstanceDescendant {
  path: string;
  node: SceneNode;
  absX: number;
  absY: number;
  width: number;
  height: number;
}

function assignFreshIds(node: SceneNode): SceneNode {
  const id = generateId();
  if (node.type === "frame") {
    return {
      ...node,
      id,
      children: node.children.map(assignFreshIds),
    };
  }
  if (node.type === "group") {
    return {
      ...node,
      id,
      children: node.children.map(assignFreshIds),
    };
  }
  return { ...node, id };
}

function getSnapshot(
  refNode: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById?: Record<string, string | null>,
): ResolvedInstanceSnapshot | null {
  const resolvedParentById = parentById ?? (() => {
    const nextParentById: Record<string, string | null> = {};
    for (const id of Object.keys(nodesById)) {
      nextParentById[id] = null;
    }
    for (const [ownerId, childIds] of Object.entries(childrenById)) {
      for (const childId of childIds) {
        nextParentById[childId] = ownerId;
      }
    }
    return nextParentById;
  })();
  return getResolvedInstanceSnapshot(refNode, {
    nodesById,
    childrenById,
    parentById: resolvedParentById,
  });
}

export function findNodeByPath(
  children: SceneNode[],
  path: string,
  _nodesById?: Record<string, FlatSceneNode>,
  _childrenById?: Record<string, string[]>,
): SceneNode | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let currentChildren = children;
  let current: SceneNode | null = null;
  for (const segment of segments) {
    current = currentChildren.find((child) => child.id === segment) ?? null;
    if (!current) return null;
    currentChildren = isContainerNode(current) ? current.children : [];
  }
  return current;
}

export function collectDescendantPaths(children: SceneNode[]): ResolvedDescendant[] {
  const result: ResolvedDescendant[] = [];

  const visit = (nodes: SceneNode[], parentPath = "") => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}/${node.id}` : node.id;
      result.push({ path, node });
      if (isContainerNode(node)) {
        visit(node.children, path);
      }
    }
  };

  visit(children);
  return result;
}

export function resolveRefToTree(
  refNode: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  _visitedComponentIds?: Set<string>,
): FrameNode | null {
  return getSnapshot(refNode, nodesById, childrenById)?.tree ?? null;
}

export function resolveRefToFrame(
  refId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById?: Record<string, string | null>,
): FrameNode | null {
  const node = nodesById[refId];
  if (!node || node.type !== "ref") return null;
  const resolved = getSnapshot(node as RefNode, nodesById, childrenById, parentById)?.tree;
  if (!resolved) return null;
  return assignFreshIds(resolved) as FrameNode;
}

export function getResolvedSnapshotForRef(
  refNode: RefNode,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById: Record<string, string | null>,
): ResolvedInstanceSnapshot | null {
  return getSnapshot(refNode, nodesById, childrenById, parentById);
}

export function findResolvedDescendantByPath(
  refNode: RefNode,
  descendantPath: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById: Record<string, string | null>,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): ResolvedInstanceDescendant | null {
  const snapshot = getSnapshot(refNode, nodesById, childrenById, parentById);
  if (!snapshot) return null;

  const descendantNode = snapshot.nodesByPath[descendantPath];
  const descendantBounds = snapshot.layoutBoundsByPath[descendantPath];
  if (!descendantNode || !descendantBounds) return null;

  const rootIds = Object.entries(parentById)
    .filter(([, candidateParentId]) => candidateParentId == null)
    .map(([id]) => id);
  const sceneTree = buildTree(rootIds, nodesById, childrenById);
  const instanceAbsPos =
    getNodeAbsolutePositionWithLayout(
      sceneTree,
      refNode.id,
      calculateLayoutForFrame,
    ) ?? getAbsolutePositionFlat(refNode.id, nodesById, parentById);

  return {
    path: descendantPath,
    node: descendantNode,
    absX: instanceAbsPos.x + descendantBounds.x,
    absY: instanceAbsPos.y + descendantBounds.y,
    width: descendantBounds.width,
    height: descendantBounds.height,
  };
}
