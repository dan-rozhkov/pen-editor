import type {
  FlatFrameNode,
  FlatSceneNode,
  FrameNode,
  InstanceOverride,
  RefNode,
  SceneNode,
} from "@/types/scene";
import { buildTree, generateId, isContainerNode } from "@/types/scene";
import { deepCloneNode } from "@/utils/cloneNode";
import { getPreparedNodeEffectiveSize, prepareFrameNode } from "@/utils/instanceUtils";
import { getAbsolutePositionFlat } from "@/utils/nodeUtils";

export interface ResolvedDescendant {
  path: string
  node: SceneNode
}

export interface ResolvedInstanceDescendant {
  path: string
  node: SceneNode
  absX: number
  absY: number
  width: number
  height: number
}

function getOverrideForPath(
  overrides: RefNode["overrides"],
  path: string,
): InstanceOverride | undefined {
  return overrides?.[path];
}

function resolveNodeAtPath(
  node: SceneNode,
  path: string,
  overrides: RefNode["overrides"],
): SceneNode | null {
  const override = getOverrideForPath(overrides, path);
  if (override?.kind === "replace") {
    return deepCloneNode(override.node);
  }

  const updateProps = override?.kind === "update" ? override.props : {};
  const updated = { ...node, ...updateProps } as SceneNode;
  if (updated.enabled === false) return null;

  if (isContainerNode(updated)) {
    const nextChildren = updated.children
      .map((child) => resolveNodeAtPath(child, path ? `${path}/${child.id}` : child.id, overrides))
      .filter(Boolean) as SceneNode[];
    return { ...updated, children: nextChildren };
  }

  return updated;
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

export function findNodeByPath(children: SceneNode[], path: string): SceneNode | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let currentChildren = children;
  let current: SceneNode | null = null;
  for (const segment of segments) {
    current = currentChildren.find((child) => child.id === segment) ?? null;
    if (!current) return null;
    currentChildren =
      current.type === "frame" || current.type === "group" ? current.children : [];
  }
  return current;
}

export function collectDescendantPaths(children: SceneNode[]): ResolvedDescendant[] {
  const result: ResolvedDescendant[] = [];

  const visit = (nodes: SceneNode[], parentPath = "") => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}/${node.id}` : node.id;
      result.push({ path, node });
      if (node.type === "frame" || node.type === "group") {
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
): FrameNode | null {
  const component = nodesById[refNode.componentId];
  if (!component || component.type !== "frame" || !(component as FlatFrameNode).reusable) {
    return null;
  }

  const tree = buildTree([refNode.componentId], nodesById, childrenById)[0];
  if (!tree || tree.type !== "frame") return null;

  const resolvedChildren = tree.children
    .map((child) => resolveNodeAtPath(child, child.id, refNode.overrides))
    .filter(Boolean) as SceneNode[];

  return {
    ...tree,
    x: refNode.x,
    y: refNode.y,
    width: refNode.width,
    height: refNode.height,
    fill: refNode.fill ?? tree.fill,
    stroke: refNode.stroke ?? tree.stroke,
    strokeWidth: refNode.strokeWidth ?? tree.strokeWidth,
    fillBinding: refNode.fillBinding ?? tree.fillBinding,
    strokeBinding: refNode.strokeBinding ?? tree.strokeBinding,
    visible: refNode.visible,
    enabled: refNode.enabled,
    children: resolvedChildren,
  };
}

export function resolveRefToFrame(
  refId: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): FrameNode | null {
  const node = nodesById[refId];
  if (!node || node.type !== "ref") return null;
  const resolved = resolveRefToTree(node as RefNode, nodesById, childrenById);
  if (!resolved) return null;
  return assignFreshIds(resolved) as FrameNode;
}

function getResolvedChildNodes(
  node: SceneNode,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): SceneNode[] {
  if (node.type === "frame" && node.layout?.autoLayout) {
    return prepareFrameNode(node, calculateLayoutForFrame).layoutChildren;
  }
  return isContainerNode(node) ? node.children : [];
}

export function findResolvedDescendantByPath(
  refNode: RefNode,
  descendantPath: string,
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
  parentById: Record<string, string | null>,
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): ResolvedInstanceDescendant | null {
  const resolved = resolveRefToTree(refNode, nodesById, childrenById);
  if (!resolved) return null;
  const instanceAbsPos = getAbsolutePositionFlat(refNode.id, nodesById, parentById);

  const visit = (
    nodes: SceneNode[],
    parentAbsX: number,
    parentAbsY: number,
    parentPath = "",
  ): ResolvedInstanceDescendant | null => {
    for (const node of nodes) {
      const path = parentPath ? `${parentPath}/${node.id}` : node.id;
      const absX = parentAbsX + node.x;
      const absY = parentAbsY + node.y;
      const { width, height } = getPreparedNodeEffectiveSize(node, [], calculateLayoutForFrame);

      if (path === descendantPath) {
        return { path, node, absX, absY, width, height };
      }

      const childResult = visit(
        getResolvedChildNodes(node, calculateLayoutForFrame),
        absX,
        absY,
        path,
      );
      if (childResult) return childResult;
    }
    return null;
  };

  return visit(resolved.children, instanceAbsPos.x, instanceAbsPos.y);
}
