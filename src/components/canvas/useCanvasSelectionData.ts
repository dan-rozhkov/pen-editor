import { useMemo } from "react";
import type { FrameNode, GroupNode, SceneNode, TextNode } from "@/types/scene";
import {
  findNodeById,
  findParentFrame,
  getNodeAbsolutePosition,
  getNodeAbsolutePositionWithLayout,
} from "@/utils/nodeUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";

interface CanvasSelectionDataParams {
  nodes: SceneNode[];
  visibleNodes: SceneNode[];
  selectedIds: string[];
  editingNodeId: string | null;
  editingMode: "text" | "name" | null;
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[];
}

export function useCanvasSelectionData({
  nodes,
  visibleNodes,
  selectedIds,
  editingNodeId,
  editingMode,
  calculateLayoutForFrame,
}: CanvasSelectionDataParams) {
  const editingTextNode = useMemo(() => {
    if (!editingNodeId || editingMode !== "text") return null;
    return findNodeById(nodes, editingNodeId) as TextNode | null;
  }, [editingNodeId, editingMode, nodes]);

  const editingNameNode = useMemo(() => {
    if (!editingNodeId || editingMode !== "name") return null;
    return findNodeById(nodes, editingNodeId) as FrameNode | null;
  }, [editingNodeId, editingMode, nodes]);

  const transformerColor = useMemo(() => {
    const defaultColor = "#0d99ff";
    const componentColor = "#9747ff";

    for (const id of selectedIds) {
      const node = findNodeById(nodes, id);
      if (
        node &&
        ((node.type === "frame" && (node as FrameNode).reusable) ||
          node.type === "ref")
      ) {
        return componentColor;
      }
    }
    return defaultColor;
  }, [selectedIds, nodes]);

  const editingNamePosition = useMemo(() => {
    if (!editingNameNode) return null;
    return getNodeAbsolutePosition(nodes, editingNameNode.id);
  }, [editingNameNode, nodes]);

  const editingTextPosition = useMemo(() => {
    if (!editingTextNode) return null;
    return getNodeAbsolutePositionWithLayout(
      nodes,
      editingTextNode.id,
      calculateLayoutForFrame,
    );
  }, [editingTextNode, nodes, calculateLayoutForFrame]);

  const collectFrameNodes = useMemo(() => {
    const frames: Array<{
      node: FrameNode | GroupNode;
      absX: number;
      absY: number;
      isNested: boolean;
    }> = [];
    for (const node of visibleNodes) {
      if (node.type === "frame" || node.type === "group") {
        frames.push({
          node: node as FrameNode | GroupNode,
          absX: node.x,
          absY: node.y,
          isNested: false,
        });
      }
    }
    return frames;
  }, [visibleNodes]);

  const collectSelectedNodes = useMemo(() => {
    const result: Array<{
      node: SceneNode;
      absX: number;
      absY: number;
      effectiveWidth: number;
      effectiveHeight: number;
    }> = [];

    if (selectedIds.length === 0) return result;

    for (const id of selectedIds) {
      const node = findNodeById(nodes, id);
      if (!node) continue;

      const absPos = getNodeAbsolutePositionWithLayout(
        nodes,
        id,
        calculateLayoutForFrame,
      );
      if (!absPos) continue;

      let effectiveWidth = node.width;
      let effectiveHeight = node.height;

      if (node.type === "frame" && node.layout?.autoLayout) {
        const fitWidth = node.sizing?.widthMode === "fit_content";
        const fitHeight = node.sizing?.heightMode === "fit_content";
        if (fitWidth || fitHeight) {
          const intrinsicSize = calculateFrameIntrinsicSize(node, {
            fitWidth,
            fitHeight,
          });
          if (fitWidth) effectiveWidth = intrinsicSize.width;
          if (fitHeight) effectiveHeight = intrinsicSize.height;
        }
      }

      const parentContext = findParentFrame(nodes, node.id);
      if (
        parentContext.isInsideAutoLayout &&
        parentContext.parent &&
        parentContext.parent.type === "frame"
      ) {
        const widthMode = node.sizing?.widthMode ?? "fixed";
        const heightMode = node.sizing?.heightMode ?? "fixed";

        if (widthMode !== "fixed" || heightMode !== "fixed") {
          const layoutChildren = calculateLayoutForFrame(parentContext.parent);
          const layoutNode = layoutChildren.find((n) => n.id === node.id);
          if (layoutNode) {
            if (widthMode !== "fixed") effectiveWidth = layoutNode.width;
            if (heightMode !== "fixed") effectiveHeight = layoutNode.height;
          }
        }
      }

      result.push({
        node,
        absX: absPos.x,
        absY: absPos.y,
        effectiveWidth,
        effectiveHeight,
      });
    }
    return result;
  }, [selectedIds, nodes, calculateLayoutForFrame]);

  const selectionBoundingBox = useMemo(() => {
    if (collectSelectedNodes.length <= 1) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const {
      absX,
      absY,
      effectiveWidth,
      effectiveHeight,
    } of collectSelectedNodes) {
      minX = Math.min(minX, absX);
      minY = Math.min(minY, absY);
      maxX = Math.max(maxX, absX + effectiveWidth);
      maxY = Math.max(maxY, absY + effectiveHeight);
    }

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    };
  }, [collectSelectedNodes]);

  return {
    editingTextNode,
    editingNameNode,
    editingTextPosition,
    editingNamePosition,
    transformerColor,
    collectFrameNodes,
    collectSelectedNodes,
    selectionBoundingBox,
  };
}
