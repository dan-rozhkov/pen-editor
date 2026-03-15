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
import { getAbsolutePositionFlat, getNodeAbsolutePositionWithLayout } from "@/utils/nodeUtils";
import { syncTextDimensions, hasTextMeasureProps } from "@/store/sceneStore/helpers/textSync";

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
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
  visitedComponentIds?: Set<string>,
): SceneNode | null {
  const override = getOverrideForPath(overrides, path);
  if (override?.kind === "replace") {
    return deepCloneNode(override.node);
  }

  const updateProps = override?.kind === "update" ? override.props : {};
  let updated = { ...node, ...updateProps } as SceneNode;
  if (updated.enabled === false) return null;

  // Re-measure text dimensions if text-related properties were overridden
  if (updated.type === "text" && Object.keys(updateProps).length > 0 && hasTextMeasureProps(updateProps as Partial<SceneNode>)) {
    updated = syncTextDimensions(updated);
  }

  // Resolve nested RefNode — expand it into its tree form with sub-overrides
  if (updated.type === "ref" && nodesById && childrenById) {
    const refNode = updated as RefNode;
    const visited = visitedComponentIds ? new Set(visitedComponentIds) : new Set<string>();
    if (visited.has(refNode.componentId)) return updated; // circular ref guard
    visited.add(refNode.componentId);

    const resolved = resolveRefToTree(refNode, nodesById, childrenById, visited);
    if (!resolved) return updated;

    // Extract sub-overrides: outer overrides with paths starting with "{path}/"
    const subOverrides: Record<string, InstanceOverride> = {};
    if (overrides) {
      const prefix = path + "/";
      for (const [key, value] of Object.entries(overrides)) {
        if (key.startsWith(prefix)) {
          subOverrides[key.slice(prefix.length)] = value;
        }
      }
    }

    // Preserve the ref's ID so path-based lookups work consistently
    const resolvedWithRefId = { ...resolved, id: refNode.id } as FrameNode;

    // Apply sub-overrides to resolved children
    if (Object.keys(subOverrides).length > 0) {
      const resolvedChildren = resolvedWithRefId.children
        .map((child) =>
          resolveNodeAtPath(child, child.id, subOverrides, nodesById, childrenById, new Set(visited)),
        )
        .filter(Boolean) as SceneNode[];
      return { ...resolvedWithRefId, children: resolvedChildren };
    }

    return resolvedWithRefId;
  }

  if (isContainerNode(updated)) {
    const nextChildren = updated.children
      .map((child) => resolveNodeAtPath(child, path ? `${path}/${child.id}` : child.id, overrides, nodesById, childrenById, visitedComponentIds))
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

export function findNodeByPath(
  children: SceneNode[],
  path: string,
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
): SceneNode | null {
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let currentChildren = children;
  let current: SceneNode | null = null;
  for (const segment of segments) {
    current = currentChildren.find((child) => child.id === segment) ?? null;
    if (!current) return null;

    if (current.type === "ref" && nodesById && childrenById) {
      // Resolve nested ref and continue into its children
      const resolved = resolveRefToTree(current as RefNode, nodesById, childrenById);
      if (resolved) {
        currentChildren = resolved.children;
      } else {
        currentChildren = [];
      }
    } else {
      currentChildren =
        current.type === "frame" || current.type === "group" ? current.children : [];
    }
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
  visitedComponentIds?: Set<string>,
): FrameNode | null {
  const component = nodesById[refNode.componentId];
  if (!component || component.type !== "frame" || !(component as FlatFrameNode).reusable) {
    if (import.meta.env.DEV) {
      console.warn(
        `[resolveRefToTree] Failed to resolve ref ${refNode.id} → componentId=${refNode.componentId}:`,
        !component ? "component not found in nodesById" :
        component.type !== "frame" ? `unexpected type "${component.type}"` :
        "component is not reusable",
      );
    }
    return null;
  }

  const tree = buildTree([refNode.componentId], nodesById, childrenById)[0];
  if (!tree || tree.type !== "frame") return null;

  const resolvedChildren = tree.children
    .map((child) => resolveNodeAtPath(child, child.id, refNode.overrides, nodesById, childrenById, visitedComponentIds))
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
    sizing: refNode.sizing ?? tree.sizing,
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
  nodesById?: Record<string, FlatSceneNode>,
  childrenById?: Record<string, string[]>,
): SceneNode[] {
  if (node.type === "frame" && node.layout?.autoLayout) {
    return prepareFrameNode(node, calculateLayoutForFrame).layoutChildren;
  }
  // Resolve nested ref as safety net
  if (node.type === "ref" && nodesById && childrenById) {
    const resolved = resolveRefToTree(node as RefNode, nodesById, childrenById);
    if (resolved) {
      if (resolved.layout?.autoLayout) {
        return prepareFrameNode(resolved, calculateLayoutForFrame).layoutChildren;
      }
      return resolved.children;
    }
    return [];
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
  const rootIds = Object.entries(parentById)
    .filter(([, parentId]) => parentId == null)
    .map(([id]) => id);
  const sceneTree = buildTree(rootIds, nodesById, childrenById);
  const instanceAbsPos =
    getNodeAbsolutePositionWithLayout(
      sceneTree,
      refNode.id,
      calculateLayoutForFrame,
    ) ?? getAbsolutePositionFlat(refNode.id, nodesById, parentById);

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
        getResolvedChildNodes(node, calculateLayoutForFrame, nodesById, childrenById),
        absX,
        absY,
        path,
      );
      if (childResult) return childResult;
    }
    return null;
  };

  // Use layout-computed children for the root resolved frame (auto-layout)
  const rootChildren = getResolvedChildNodes(resolved, calculateLayoutForFrame, nodesById, childrenById);
  return visit(rootChildren, instanceAbsPos.x, instanceAbsPos.y);
}
