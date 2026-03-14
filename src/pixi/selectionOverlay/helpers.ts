import { CanvasTextMetrics, Container, Graphics } from "pixi.js";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize } from "@/utils/nodeUtils";
import type {
  FlatFrameNode,
  FlatSceneNode,
  RefNode,
  SceneNode,
  TextNode,
} from "@/types/scene";
import { applyTextTransform } from "@/utils/textMeasure";
import { buildTextStyle } from "@/pixi/renderers/textRenderer";
import { findResolvedDescendantByPath } from "@/utils/instanceRuntime";
import { COMPONENT_SELECTION_COLOR, SELECTION_COLOR } from "./constants";

export type Rect = { x: number; y: number; width: number; height: number };

export function createOverlayHelpers(sceneRoot: Container) {
  function findNodeContainerById(
    root: Container,
    nodeId: string,
  ): Container | null {
    for (const child of root.children) {
      if (!(child instanceof Container)) continue;
      if (child.label === nodeId) return child;
      const found = findNodeContainerById(child, nodeId);
      if (found) return found;
    }
    return null;
  }

  function getRenderedNodeRect(nodeId: string): Rect | null {
    const nodeContainer = findNodeContainerById(sceneRoot, nodeId);
    if (!nodeContainer) return null;
    const b = nodeContainer.getBounds();
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.width) || !Number.isFinite(b.height)) {
      return null;
    }
    const { x: viewportX, y: viewportY, scale } = useViewportStore.getState();
    const safeScale = scale || 1;
    return {
      x: (b.x - viewportX) / safeScale,
      y: (b.y - viewportY) / safeScale,
      width: b.width / safeScale,
      height: b.height / safeScale,
    };
  }

  function getAbsolutePosition(nodeId: string): { x: number; y: number } | null {
    const nodes = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutPos = getNodeAbsolutePositionWithLayout(
      nodes,
      nodeId,
      calculateLayoutForFrame,
    );
    if (layoutPos) return layoutPos;

    const renderedRect = getRenderedNodeRect(nodeId);
    if (!renderedRect) return null;
    return { x: renderedRect.x, y: renderedRect.y };
  }

  function getEffectiveSize(nodeId: string): { width: number; height: number } | null {
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    if (!node) return null;

    const sceneNodes = state.getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutSize = getNodeEffectiveSize(sceneNodes, nodeId, calculateLayoutForFrame);
    if (layoutSize) return layoutSize;

    const renderedRect = getRenderedNodeRect(nodeId);
    if (renderedRect) {
      return { width: renderedRect.width, height: renderedRect.height };
    }

    return { width: node.width, height: node.height };
  }

  function isComponentOrInstance(nodeId: string): boolean {
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    return (
      (node?.type === "frame" && !!(node as FlatFrameNode).reusable) ||
      node?.type === "ref"
    );
  }

  function isInComponentContext(nodeId: string): boolean {
    const state = useSceneStore.getState();
    let currentId: string | null = nodeId;

    while (currentId) {
      if (isComponentOrInstance(currentId)) {
        return true;
      }
      currentId = state.parentById[currentId] ?? null;
    }

    return false;
  }

  function getSelectionColor(nodeId: string): number {
    if (isInComponentContext(nodeId)) {
      return COMPONENT_SELECTION_COLOR;
    }
    const state = useSceneStore.getState();
    const node = state.nodesById[nodeId];
    if (
      (node?.type === "frame" && (node as FlatFrameNode).reusable) ||
      node?.type === "ref"
    ) {
      return COMPONENT_SELECTION_COLOR;
    }
    return SELECTION_COLOR;
  }

  function getDrawRect(
    node: FlatSceneNode,
    absPos: { x: number; y: number },
    size: { width: number; height: number },
  ): Rect {
    if (node.type !== "embed") {
      return { x: absPos.x, y: absPos.y, width: size.width, height: size.height };
    }
    return {
      x: Math.round(absPos.x),
      y: Math.round(absPos.y),
      width: Math.max(1, Math.round(size.width)),
      height: Math.max(1, Math.round(size.height)),
    };
  }

  /** Combines getAbsolutePosition + getEffectiveSize + getDrawRect for a single node. */
  function getNodeDrawRect(nodeId: string): Rect | null {
    const node = useSceneStore.getState().nodesById[nodeId];
    if (!node) return null;
    const absPos = getAbsolutePosition(nodeId);
    if (!absPos) return null;
    const effectiveSize = getEffectiveSize(nodeId);
    const width = effectiveSize?.width ?? node.width;
    const height = effectiveSize?.height ?? node.height;
    return getDrawRect(node, absPos, { width, height });
  }

  function getInstanceDescendantTarget(
    instanceId: string,
    descendantPath: string,
  ): {
    instance: RefNode;
    node: SceneNode;
    drawRect: Rect;
  } | null {
    const state = useSceneStore.getState();
    const instance = state.nodesById[instanceId];
    if (!instance || instance.type !== "ref") return null;

    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    // Use layout-computed size so fill_container refs resolve inner children correctly
    const effectiveSize = getEffectiveSize(instanceId);
    const refWithLayout: RefNode = effectiveSize
      ? { ...(instance as RefNode), width: effectiveSize.width, height: effectiveSize.height }
      : (instance as RefNode);
    const resolved = findResolvedDescendantByPath(
      refWithLayout,
      descendantPath,
      state.nodesById,
      state.childrenById,
      state.parentById,
      calculateLayoutForFrame,
    );
    if (!resolved) return null;

    const drawRect =
      resolved.node.type === "embed"
        ? {
            x: Math.round(resolved.absX),
            y: Math.round(resolved.absY),
            width: Math.max(1, Math.round(resolved.width)),
            height: Math.max(1, Math.round(resolved.height)),
          }
        : {
            x: resolved.absX,
            y: resolved.absY,
            width: resolved.width,
            height: resolved.height,
          };

    return { instance: instance as RefNode, node: resolved.node, drawRect };
  }

  return {
    getAbsolutePosition,
    getEffectiveSize,
    getSelectionColor,
    getDrawRect,
    getNodeDrawRect,
    isInComponentContext,
    getInstanceDescendantTarget,
  };
}

export type OverlayHelpers = ReturnType<typeof createOverlayHelpers>;

/** Draw text baseline indicators for a text node. */
export function drawTextBaselines(
  gfx: Graphics,
  node: TextNode,
  absX: number,
  absY: number,
  width: number,
  scale: number,
  color: number,
): void {
  const style = buildTextStyle(node);
  const metrics = CanvasTextMetrics.measureText(applyTextTransform(node.text ?? "", node.textTransform), style);
  const lineWidths = metrics.lineWidths ?? [];
  const lineCount = Math.max(1, metrics.lines?.length ?? 0);
  const lineHeight =
    metrics.lineHeight || (node.fontSize ?? 16) * (node.lineHeight ?? 1.2);
  const fontAscent = metrics.fontProperties?.ascent ?? (node.fontSize ?? 16) * 0.8;
  const fontPixelSize =
    metrics.fontProperties?.fontSize ?? (node.fontSize ?? 16);
  const baselineOffset = fontAscent + Math.max(0, (lineHeight - fontPixelSize) / 2);
  const textAlign = node.textAlign ?? "left";
  const maxLineWidth = lineWidths.length > 0 ? Math.max(...lineWidths) : width;
  const textBoxWidth =
    node.textWidthMode === "fixed" || node.textWidthMode === "fixed-height"
      ? width
      : maxLineWidth;

  for (let i = 0; i < lineCount; i++) {
    const lineWidth = lineWidths[i] ?? 0;
    if (lineWidth <= 0) continue;

    let lineX = absX;
    if (textAlign === "center") {
      lineX += (textBoxWidth - lineWidth) / 2;
    } else if (textAlign === "right") {
      lineX += textBoxWidth - lineWidth;
    }

    const lineY = absY + i * lineHeight + baselineOffset;
    gfx.moveTo(lineX, lineY);
    gfx.lineTo(lineX + lineWidth, lineY);
    gfx.stroke({ color, width: 1 / scale });
  }
}

/** Draw a dashed rectangle outline (axis-aligned). */
export function drawDashedRect(
  gfx: Graphics,
  rect: Rect,
  color: number,
  scale: number,
): void {
  const dash = 4 / scale;
  const seg = dash * 2; // dash + gap (equal size)
  const { x, y, width: w, height: h } = rect;

  const drawDashes = (x1: number, y1: number, x2: number, y2: number) => {
    const horizontal = y1 === y2;
    const len = horizontal ? Math.abs(x2 - x1) : Math.abs(y2 - y1);
    const dir = horizontal ? Math.sign(x2 - x1) : Math.sign(y2 - y1);
    let d = 0;
    while (d < len) {
      const end = Math.min(d + dash, len);
      if (horizontal) {
        gfx.moveTo(x1 + dir * d, y1);
        gfx.lineTo(x1 + dir * end, y1);
      } else {
        gfx.moveTo(x1, y1 + dir * d);
        gfx.lineTo(x1, y1 + dir * end);
      }
      d += seg;
    }
  };

  drawDashes(x, y, x + w, y);         // top
  drawDashes(x + w, y, x + w, y + h); // right
  drawDashes(x + w, y + h, x, y + h); // bottom
  drawDashes(x, y + h, x, y);         // left
  gfx.stroke({ color, width: 1 / scale });
}
