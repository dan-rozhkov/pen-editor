import { CanvasTextMetrics, TextStyle } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { SceneNode, FrameNode } from "@/types/scene";
import {
  findNodeById,
  getNodeAbsolutePositionWithLayout,
  getNodeEffectiveSize,
} from "@/utils/nodeUtils";
import {
  getPreparedNodeEffectiveSize,
  prepareFrameNode,
} from "@/components/nodes/instanceUtils";
import type { TransformHandle } from "./types";

const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET_Y = 4;
const LABEL_HIT_PADDING = 2;
const LABEL_FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const LABEL_TEXT_STYLE = new TextStyle({
  fontFamily: LABEL_FONT_FAMILY,
  fontSize: LABEL_FONT_SIZE,
});
const labelWidthCache = new Map<string, number>();

function getLabelWidth(text: string): number {
  const cached = labelWidthCache.get(text);
  if (cached !== undefined) return cached;
  const measured = CanvasTextMetrics.measureText(text, LABEL_TEXT_STYLE).width;
  labelWidthCache.set(text, measured);
  return measured;
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
 * Find a frame/group label at the given world coordinates.
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
    if (!node || node.visible === false) continue;
    if (node.type !== "frame" && node.type !== "group") continue;
    frameIds.push(rootId);
  }

  // Hit-test from top-most drawn label to bottom-most.
  for (let i = frameIds.length - 1; i >= 0; i--) {
    const frameId = frameIds[i];

    // Hidden while editing this exact name.
    if (editingNodeId === frameId && editingMode === "name") continue;

    const node = scene.nodesById[frameId];
    if (!node) continue;

    // We only draw labels for top-level frames/groups.
    // Their absolute position is the local x/y in root space.
    const labelX = node.x;
    const labelY = node.y;

    const defaultName = node.type === "group" ? "Group" : "Frame";
    const displayName = node.name || defaultName;

    const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;
    const labelWorldY = labelY - worldOffsetY;
    const labelW = getLabelWidth(displayName) / scale;
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
  if (options?.deepSelect) {
    return findDeepestNodeAtPoint(worldX, worldY);
  }

  const state = useSceneStore.getState();

  // Walk rootIds in reverse (top-most first)
  for (let i = state.rootIds.length - 1; i >= 0; i--) {
    const hit = hitTestNode(
      state.rootIds[i],
      worldX,
      worldY,
      0,
      0,
      state,
      false,
    );
    if (hit) return hit;
  }
  return null;
}

/**
 * Deep-select hit test used for Cmd/Ctrl+Click.
 * Returns the deepest node under cursor using layout-aware child positions.
 */
export function findDeepestNodeAtPoint(worldX: number, worldY: number): string | null {
  const state = useSceneStore.getState();
  const sceneNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;

  const hitInList = (
    nodes: SceneNode[],
    parentAbsX: number,
    parentAbsY: number,
  ): string | null => {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      if (node.visible === false) continue;

      const absX = parentAbsX + node.x;
      const absY = parentAbsY + node.y;
      const { width, height } = getPreparedNodeEffectiveSize(
        node,
        sceneNodes,
        calculateLayoutForFrame,
      );

      if (
        worldX < absX ||
        worldX > absX + width ||
        worldY < absY ||
        worldY > absY + height
      ) {
        continue;
      }

      if (node.type === "frame" || node.type === "group") {
        const childList =
          node.type === "frame" && node.layout?.autoLayout
            ? prepareFrameNode(node, calculateLayoutForFrame).layoutChildren
            : node.children;
        const childHit = hitInList(childList, absX, absY);
        if (childHit) return childHit;
      }

      return node.id;
    }
    return null;
  };

  return hitInList(sceneNodes, 0, 0);
}

/**
 * Recursive hit test for a node and its children.
 */
export function hitTestNode(
  nodeId: string,
  worldX: number,
  worldY: number,
  _parentAbsX: number,
  _parentAbsY: number,
  state: typeof useSceneStore extends { getState: () => infer S } ? S : never,
  deepSelect: boolean,
): string | null {
  const sceneNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const treeNode = findNodeById(sceneNodes, nodeId);
  const node = state.nodesById[nodeId];
  if (!node || !treeNode || node.visible === false) return null;

  const absPos = getNodeAbsolutePositionWithLayout(
    sceneNodes,
    nodeId,
    calculateLayoutForFrame,
  );
  if (!absPos) return null;
  const absX = absPos.x;
  const absY = absPos.y;
  const effectiveSize = getNodeEffectiveSize(
    sceneNodes,
    nodeId,
    calculateLayoutForFrame,
  );
  const width = effectiveSize?.width ?? node.width;
  const height = effectiveSize?.height ?? node.height;

  // Check if point is within bounds
  if (
    worldX < absX ||
    worldX > absX + width ||
    worldY < absY ||
    worldY > absY + height
  ) {
    return null;
  }

  // Check children first (deeper elements have priority)
  const childNodes =
    treeNode.type === "frame" && treeNode.layout?.autoLayout
      ? prepareFrameNode(treeNode, calculateLayoutForFrame).layoutChildren
      : treeNode.type === "frame" || treeNode.type === "group"
        ? treeNode.children
        : [];
  for (let i = childNodes.length - 1; i >= 0; i--) {
    const childId = childNodes[i].id;
    const childHit = hitTestNode(
      childId,
      worldX,
      worldY,
      absX,
      absY,
      state,
      deepSelect,
    );
    if (childHit) {
      if (deepSelect) return childHit;
      const selectedIds = useSelectionStore.getState().selectedIds;
      if (selectedIds.includes(childHit)) {
        return childHit;
      }
      // Nested selection logic: check if we should select the child or the parent
      const enteredContainerId = useSelectionStore.getState().enteredContainerId;
      if (enteredContainerId === nodeId) {
        return childHit;
      }
      // If this is a top-level frame, select the frame itself (not children)
      // unless user has entered the container via double-click
      if (state.parentById[nodeId] === null) {
        return nodeId;
      }
      return nodeId;
    }
  }

  return nodeId;
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
} | null {
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length !== 1) return null;

  const state = useSceneStore.getState();
  const nodeId = selectedIds[0];
  const node = state.nodesById[nodeId];
  if (!node) return null;

  const treeNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const absPos = getNodeAbsolutePositionWithLayout(treeNodes, nodeId, calculateLayoutForFrame);
  if (!absPos) return null;
  const effectiveSize = getNodeEffectiveSize(treeNodes, nodeId, calculateLayoutForFrame);
  const width = effectiveSize?.width ?? node.width;
  const height = effectiveSize?.height ?? node.height;
  const absX = absPos.x;
  const absY = absPos.y;

  const scale = useViewportStore.getState().scale;
  const handleRadius = 6 / scale; // Hit area slightly larger than visual handle

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
      return { corner, nodeId, absX, absY, width, height };
    }
  }

  // Side handles (skip corner zones to avoid ambiguity)
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
    return { corner: "l", nodeId, absX, absY, width, height };
  }
  if (
    distRight <= sideTolerance &&
    worldY >= absY + cornerExclusion &&
    worldY <= absY + height - cornerExclusion
  ) {
    return { corner: "r", nodeId, absX, absY, width, height };
  }
  if (
    distTop <= sideTolerance &&
    worldX >= absX + cornerExclusion &&
    worldX <= absX + width - cornerExclusion
  ) {
    return { corner: "t", nodeId, absX, absY, width, height };
  }
  if (
    distBottom <= sideTolerance &&
    worldX >= absX + cornerExclusion &&
    worldX <= absX + width - cornerExclusion
  ) {
    return { corner: "b", nodeId, absX, absY, width, height };
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
