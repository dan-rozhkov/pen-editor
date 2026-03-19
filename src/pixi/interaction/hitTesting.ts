import { TextStyle } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { SceneNode, FrameNode, FlatSceneNode, RefNode, ConnectorNode } from "@/types/scene";
import {
  getPreparedNodeEffectiveSize,
  prepareFrameNode,
} from "@/utils/instanceUtils";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import type { TransformHandle } from "./types";
import { measureLabelTextWidth, truncateLabelToWidth } from "@/pixi/frameLabelUtils";
import { resolveRefToTree, findResolvedDescendantByPath } from "@/utils/instanceRuntime";

export type CanvasHitTarget =
  | { kind: "node"; nodeId: string }
  | { kind: "instance-descendant"; instanceId: string; descendantPath: string };

const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET_Y = 4;
const LABEL_HIT_PADDING = 2;
const LABEL_FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const LABEL_TEXT_STYLE = new TextStyle({
  fontFamily: LABEL_FONT_FAMILY,
  fontSize: LABEL_FONT_SIZE,
});

function pointToSegmentDistance(
  px: number, py: number,
  x1: number, y1: number,
  x2: number, y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  const projX = x1 + t * dx;
  const projY = y1 + t * dy;
  return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
}

function getHitNodeEffectiveSize(
  node: SceneNode,
  sceneNodes: SceneNode[],
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
  nodesById: Record<string, FlatSceneNode>,
  childrenById: Record<string, string[]>,
): { width: number; height: number } {
  if (node.type === "ref") {
    const resolved = resolveRefToTree(
      node as RefNode,
      nodesById,
      childrenById,
    );
    if (resolved) {
      return getPreparedNodeEffectiveSize(
        resolved,
        sceneNodes,
        calculateLayoutForFrame,
      );
    }
  }

  return getPreparedNodeEffectiveSize(node, sceneNodes, calculateLayoutForFrame);
}

/**
 * Convert screen coordinates to world coordinates
 */
export function screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
  const vs = useViewportStore.getState();
  return {
    x: (screenX - vs.x) / vs.scale,
    y: (screenY - vs.y) / vs.scale,
  };
}

/**
 * Find a frame/group/embed label at the given world coordinates.
 * Returns the node ID if a label is hit, null otherwise.
 */
export function findFrameLabelAtPoint(worldX: number, worldY: number): string | null {
  const scene = useSceneStore.getState();
  const { editingNodeId, editingMode } = useSelectionStore.getState();
  const scale = useViewportStore.getState().scale || 1;

  const frameIds: string[] = [];

  // Match overlay visibility: top-level frames/groups only (same as Konva).
  for (const rootId of scene.rootIds) {
    const node = scene.nodesById[rootId];
    if (!node || node.visible === false || node.enabled === false) continue;
    if (node.type !== "frame" && node.type !== "group" && node.type !== "embed") continue;
    frameIds.push(rootId);
  }

  // Hit-test from top-most drawn label to bottom-most.
  for (let i = frameIds.length - 1; i >= 0; i--) {
    const frameId = frameIds[i];

    // Hidden while editing this exact name.
    if (editingNodeId === frameId && editingMode === "name") continue;

    const node = scene.nodesById[frameId] as FlatSceneNode | undefined;
    if (!node) continue;

    // We only draw labels for top-level frames/groups.
    // Their absolute position is the local x/y in root space.
    const labelX = node.x;
    const labelY = node.y;

    const defaultName =
      node.type === "group" ? "Group" : node.type === "embed" ? "Embed" : "Frame";
    const fullName = node.name || defaultName;
    const maxLabelWidthPx = Math.max(0, node.width * scale);
    const displayName = truncateLabelToWidth(fullName, maxLabelWidthPx, LABEL_TEXT_STYLE);
    if (!displayName) continue;

    const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;
    const labelWorldY = labelY - worldOffsetY;
    const labelW = measureLabelTextWidth(displayName, LABEL_TEXT_STYLE) / scale;
    const labelH = LABEL_FONT_SIZE / scale;
    const padding = LABEL_HIT_PADDING / scale;

    if (
      worldX >= labelX - padding &&
      worldX <= labelX + labelW + padding &&
      worldY >= labelWorldY - padding &&
      worldY <= labelWorldY + labelH + padding
    ) {
      return frameId;
    }
  }

  return null;
}

/**
 * Find the top-most node at the given world coordinates.
 * If deepSelect is true, returns the deepest node instead.
 */
export function findNodeAtPoint(
  worldX: number,
  worldY: number,
  options?: { deepSelect?: boolean },
): string | null {
  const target = findCanvasHitTargetAtPoint(worldX, worldY, options);
  return target?.kind === "node" ? target.nodeId : null;
}

export function findCanvasHitTargetAtPoint(
  worldX: number,
  worldY: number,
  options?: { deepSelect?: boolean },
): CanvasHitTarget | null {
  const state = useSceneStore.getState();
  const sceneNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const deepSelect = options?.deepSelect === true;
  const selectionState = deepSelect ? null : useSelectionStore.getState();
  const selectedSet = selectionState
    ? new Set(selectionState.selectedIds)
    : null;
  const enteredContainerId = selectionState?.enteredContainerId ?? null;
  const enteredInstanceDescendantPath = selectionState?.enteredInstanceDescendantPath ?? null;

  const hitNode = (
    node: SceneNode,
    parentAbsX: number,
    parentAbsY: number,
    parentPath = "",
  ): CanvasHitTarget | null => {
    if (node.visible === false || node.enabled === false) return null;

    const absX = parentAbsX + node.x;
    const absY = parentAbsY + node.y;
    const { width, height } = getHitNodeEffectiveSize(
      node,
      sceneNodes,
      calculateLayoutForFrame,
      state.nodesById,
      state.childrenById,
    );

    if (
      worldX < absX ||
      worldX > absX + width ||
      worldY < absY ||
      worldY > absY + height
    ) {
      return null;
    }

    // Connector nodes: use line-segment distance instead of bounding box
    if (node.type === "connector") {
      const conn = node as ConnectorNode;
      if (conn.points.length >= 4) {
        const scale = useViewportStore.getState().scale;
        const threshold = 5 / scale;
        const dist = pointToSegmentDistance(
          worldX, worldY,
          absX + conn.points[0], absY + conn.points[1],
          absX + conn.points[2], absY + conn.points[3],
        );
        if (dist <= threshold) {
          return { kind: "node", nodeId: node.id };
        }
        return null;
      }
    }

    if (node.type === "ref") {
      // Default: ref is opaque unless deep-selecting or entered
      if (!deepSelect && enteredContainerId !== node.id) {
        return { kind: "node", nodeId: node.id };
      }

      const resolved = resolveRefToTree(
        node as RefNode,
        state.nodesById,
        state.childrenById,
      );
      if (!resolved) return { kind: "node", nodeId: node.id };

      // Unified recursive hit test — returns deepest matching path
      const hitResolvedPath = (
        resolvedNode: SceneNode,
        resolvedAbsX: number,
        resolvedAbsY: number,
        resolvedPath: string,
      ): string | null => {
        if (resolvedNode.visible === false || resolvedNode.enabled === false) return null;

        const { width: resolvedWidth, height: resolvedHeight } =
          getPreparedNodeEffectiveSize(resolvedNode, [], calculateLayoutForFrame);
        if (
          worldX < resolvedAbsX ||
          worldX > resolvedAbsX + resolvedWidth ||
          worldY < resolvedAbsY ||
          worldY > resolvedAbsY + resolvedHeight
        ) {
          return null;
        }

        let resolvedChildren: SceneNode[];
        if (resolvedNode.type === "ref") {
          const nestedResolved = resolveRefToTree(
            resolvedNode as RefNode, state.nodesById, state.childrenById,
          );
          if (nestedResolved) {
            resolvedChildren = nestedResolved.layout?.autoLayout
              ? prepareFrameNode(nestedResolved, calculateLayoutForFrame).layoutChildren
              : nestedResolved.children;
          } else {
            resolvedChildren = [];
          }
        } else if (resolvedNode.type === "frame" && resolvedNode.layout?.autoLayout) {
          resolvedChildren = prepareFrameNode(resolvedNode, calculateLayoutForFrame).layoutChildren;
        } else if (resolvedNode.type === "frame" || resolvedNode.type === "group") {
          resolvedChildren = resolvedNode.children;
        } else {
          resolvedChildren = [];
        }

        for (let i = resolvedChildren.length - 1; i >= 0; i--) {
          const child = resolvedChildren[i];
          const childHit = hitResolvedPath(
            child,
            resolvedAbsX + child.x,
            resolvedAbsY + child.y,
            `${resolvedPath}/${child.id}`,
          );
          if (childHit) return childHit;
        }

        return resolvedPath;
      };

      // Find deepest hit path (apply auto-layout at root level, matching renderer)
      const rootChildren = resolved.layout?.autoLayout
        ? prepareFrameNode(resolved, calculateLayoutForFrame).layoutChildren
        : resolved.children;
      let deepHitPath: string | null = null;
      for (let i = rootChildren.length - 1; i >= 0; i--) {
        const child = rootChildren[i];
        deepHitPath = hitResolvedPath(child, absX + child.x, absY + child.y, child.id);
        if (deepHitPath) break;
      }

      if (!deepHitPath) return { kind: "node", nodeId: node.id };

      // Deep select: return full deep path
      if (deepSelect) {
        return { kind: "instance-descendant", instanceId: node.id, descendantPath: deepHitPath };
      }

      // Entered ref: truncate to first child below entered level
      const prefix = enteredInstanceDescendantPath ? enteredInstanceDescendantPath + "/" : "";
      if (deepHitPath.startsWith(prefix)) {
        const remaining = deepHitPath.slice(prefix.length);
        const firstChild = remaining.split("/")[0];
        const resultPath = enteredInstanceDescendantPath
          ? `${enteredInstanceDescendantPath}/${firstChild}`
          : firstChild;
        return { kind: "instance-descendant", instanceId: node.id, descendantPath: resultPath };
      }

      return { kind: "node", nodeId: node.id };
    }

    const childNodes =
      node.type === "frame" && node.layout?.autoLayout
        ? prepareFrameNode(node, calculateLayoutForFrame).layoutChildren
        : node.type === "frame" || node.type === "group"
          ? node.children
          : [];

    for (let i = childNodes.length - 1; i >= 0; i--) {
      const child = childNodes[i];
      const childHit = hitNode(
        child,
        absX,
        absY,
        parentPath ? `${parentPath}/${node.id}` : node.id,
      );
      if (!childHit) continue;

      if (deepSelect) return childHit;
      if (childHit.kind === "instance-descendant") return childHit;
      if (selectedSet?.has(childHit.nodeId)) return childHit;
      if (enteredContainerId === node.id) return childHit;
      if (state.parentById[node.id] === null) return { kind: "node", nodeId: node.id };
      return { kind: "node", nodeId: node.id };
    }

    return { kind: "node", nodeId: node.id };
  };

  // Walk root nodes in reverse (top-most first).
  for (let i = sceneNodes.length - 1; i >= 0; i--) {
    const hit = hitNode(sceneNodes[i], 0, 0);
    if (hit) return hit;
  }
  return null;
}

/**
 * Deep-select hit test used for Cmd/Ctrl+Click.
 * Returns the deepest node under cursor using layout-aware child positions.
 */
export function findDeepestNodeAtPoint(worldX: number, worldY: number): string | null {
  return findNodeAtPoint(worldX, worldY, { deepSelect: true });
}

/**
 * Check if a world-space point is near a transform handle of the current selection.
 * Returns the active transform handle identifier or null.
 */
export function hitTestTransformHandle(worldX: number, worldY: number): {
  corner: TransformHandle;
  nodeId: string;
  absX: number;
  absY: number;
  width: number;
  height: number;
  slotContext?: { instanceId: string; descendantPath: string };
} | null {
  const { selectedIds, instanceContext } = useSelectionStore.getState();

  const state = useSceneStore.getState();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

  // Instance descendant: only allow transform for slot frames
  if (instanceContext) {
    if (selectedIds.length !== 1) return null;
    const instance = state.nodesById[instanceContext.instanceId];
    if (!instance || instance.type !== "ref") return null;
    const effectiveSize = getEffectiveSizeForHit(instanceContext.instanceId, state, calculateLayoutForFrame);
    const refWithLayout: RefNode = effectiveSize
      ? { ...(instance as RefNode), width: effectiveSize.width, height: effectiveSize.height }
      : (instance as RefNode);
    const resolved = findResolvedDescendantByPath(
      refWithLayout,
      instanceContext.descendantPath,
      state.nodesById,
      state.childrenById,
      state.parentById,
      calculateLayoutForFrame,
    );
    if (!resolved) return null;
    if (resolved.node.type !== "frame" || !(resolved.node as FrameNode).isSlot) return null;

    const absX = resolved.absX;
    const absY = resolved.absY;
    const width = resolved.width;
    const height = resolved.height;

    return hitTestHandlesAt(worldX, worldY, absX, absY, width, height, instanceContext.instanceId, {
      instanceId: instanceContext.instanceId,
      descendantPath: instanceContext.descendantPath,
    });
  }

  if (selectedIds.length !== 1) return null;

  const nodeId = selectedIds[0];
  const treeNodes = state.getNodes();
  let bounds: { x: number; y: number; width: number; height: number } | null = null;

  const findBounds = (
    nodes: SceneNode[],
    parentAbsX: number,
    parentAbsY: number,
  ): boolean => {
    for (const n of nodes) {
      const absX = parentAbsX + n.x;
      const absY = parentAbsY + n.y;
      const { width, height } = getHitNodeEffectiveSize(
        n,
        treeNodes,
        calculateLayoutForFrame,
        state.nodesById,
        state.childrenById,
      );
      if (n.id === nodeId) {
        bounds = { x: absX, y: absY, width, height };
        return true;
      }

      const children =
        n.type === "frame" && n.layout?.autoLayout
          ? prepareFrameNode(n, calculateLayoutForFrame).layoutChildren
          : n.type === "frame" || n.type === "group"
            ? n.children
            : null;
      if (children && findBounds(children, absX, absY)) return true;
    }
    return false;
  };

  if (!findBounds(treeNodes, 0, 0) || !bounds) return null;
  const { x: absX, y: absY, width, height } = bounds;

  return hitTestHandlesAt(worldX, worldY, absX, absY, width, height, nodeId);
}

/** Get effective (layout-computed) size for a node during hit testing. */
function getEffectiveSizeForHit(
  nodeId: string,
  state: { nodesById: Record<string, FlatSceneNode>; getNodes: () => SceneNode[] },
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[],
): { width: number; height: number } | null {
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const treeNodes = state.getNodes();
  return getNodeEffectiveSize(treeNodes, nodeId, calculateLayoutForFrame) ?? { width: node.width, height: node.height };
}

/** Shared handle hit-testing logic against a known bounding rect. */
function hitTestHandlesAt(
  worldX: number,
  worldY: number,
  absX: number,
  absY: number,
  width: number,
  height: number,
  nodeId: string,
  slotContext?: { instanceId: string; descendantPath: string },
): {
  corner: TransformHandle;
  nodeId: string;
  absX: number;
  absY: number;
  width: number;
  height: number;
  slotContext?: { instanceId: string; descendantPath: string };
} | null {
  const scale = useViewportStore.getState().scale;
  const handleRadius = 6 / scale;

  const corners: Array<{ corner: "tl" | "tr" | "bl" | "br"; cx: number; cy: number }> = [
    { corner: "tl", cx: absX, cy: absY },
    { corner: "tr", cx: absX + width, cy: absY },
    { corner: "bl", cx: absX, cy: absY + height },
    { corner: "br", cx: absX + width, cy: absY + height },
  ];

  for (const { corner, cx, cy } of corners) {
    const dx = worldX - cx;
    const dy = worldY - cy;
    if (Math.abs(dx) <= handleRadius && Math.abs(dy) <= handleRadius) {
      return { corner, nodeId, absX, absY, width, height, slotContext };
    }
  }

  const sideTolerance = handleRadius;
  const cornerExclusion = handleRadius * 2;
  const distLeft = Math.abs(worldX - absX);
  const distRight = Math.abs(worldX - (absX + width));
  const distTop = Math.abs(worldY - absY);
  const distBottom = Math.abs(worldY - (absY + height));

  if (
    distLeft <= sideTolerance &&
    worldY >= absY + cornerExclusion &&
    worldY <= absY + height - cornerExclusion
  ) {
    return { corner: "l", nodeId, absX, absY, width, height, slotContext };
  }
  if (
    distRight <= sideTolerance &&
    worldY >= absY + cornerExclusion &&
    worldY <= absY + height - cornerExclusion
  ) {
    return { corner: "r", nodeId, absX, absY, width, height, slotContext };
  }
  if (
    distTop <= sideTolerance &&
    worldX >= absX + cornerExclusion &&
    worldX <= absX + width - cornerExclusion
  ) {
    return { corner: "t", nodeId, absX, absY, width, height, slotContext };
  }
  if (
    distBottom <= sideTolerance &&
    worldX >= absX + cornerExclusion &&
    worldX <= absX + width - cornerExclusion
  ) {
    return { corner: "b", nodeId, absX, absY, width, height, slotContext };
  }

  return null;
}

/**
 * Get the appropriate CSS cursor for a transform handle.
 */
export function getResizeCursor(corner: TransformHandle): string {
  switch (corner) {
    case "tl": case "br": return "nwse-resize";
    case "tr": case "bl": return "nesw-resize";
    case "l": case "r": return "ew-resize";
    case "t": case "b": return "ns-resize";
  }
}

/**
 * Find a tree-based FrameNode by ID in the tree structure.
 */
export function findFrameInTree(nodes: SceneNode[], frameId: string): FrameNode | null {
  for (const node of nodes) {
    if (node.id === frameId && node.type === "frame") return node as FrameNode;
    if (node.type === "frame" || node.type === "group") {
      const children = (node as FrameNode).children;
      if (children) {
        const found = findFrameInTree(children, frameId);
        if (found) return found;
      }
    }
  }
  return null;
}
