import { TextStyle } from "pixi.js";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useLayoutStore } from "@/store/layoutStore";
import type { SceneNode, FrameNode } from "@/types/scene";
import {
  getPreparedNodeEffectiveSize,
  prepareFrameNode,
} from "@/utils/instanceUtils";
import type { TransformHandle } from "./types";
import { measureLabelTextWidth, truncateLabelToWidth } from "@/pixi/frameLabelUtils";

const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET_Y = 4;
const LABEL_HIT_PADDING = 2;
const LABEL_FONT_FAMILY = "system-ui, -apple-system, sans-serif";
const LABEL_TEXT_STYLE = new TextStyle({
  fontFamily: LABEL_FONT_FAMILY,
  fontSize: LABEL_FONT_SIZE,
});

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
    if (!node || node.visible === false || node.enabled === false) continue;
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
  const state = useSceneStore.getState();
  const sceneNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const deepSelect = options?.deepSelect === true;
  const selectedSet = deepSelect
    ? null
    : new Set(useSelectionStore.getState().selectedIds);
  const enteredContainerId = deepSelect
    ? null
    : useSelectionStore.getState().enteredContainerId;

  const hitNode = (
    node: SceneNode,
    parentAbsX: number,
    parentAbsY: number,
  ): string | null => {
    if (node.visible === false || node.enabled === false) return null;

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
      return null;
    }

    const childNodes =
      node.type === "frame" && node.layout?.autoLayout
        ? prepareFrameNode(node, calculateLayoutForFrame).layoutChildren
        : node.type === "frame" || node.type === "group"
          ? node.children
          : [];

    for (let i = childNodes.length - 1; i >= 0; i--) {
      const child = childNodes[i];
      const childHit = hitNode(child, absX, absY);
      if (!childHit) continue;

      if (deepSelect) return childHit;
      if (selectedSet?.has(childHit)) return childHit;
      if (enteredContainerId === node.id) return childHit;
      if (state.parentById[node.id] === null) return node.id;
      return node.id;
    }

    return node.id;
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
} | null {
  const { selectedIds } = useSelectionStore.getState();
  if (selectedIds.length !== 1) return null;

  const state = useSceneStore.getState();
  const nodeId = selectedIds[0];
  const treeNodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  let bounds: { x: number; y: number; width: number; height: number } | null = null;

  const findBounds = (
    nodes: SceneNode[],
    parentAbsX: number,
    parentAbsY: number,
  ): boolean => {
    for (const n of nodes) {
      const absX = parentAbsX + n.x;
      const absY = parentAbsY + n.y;
      const { width, height } = getPreparedNodeEffectiveSize(
        n,
        treeNodes,
        calculateLayoutForFrame,
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
