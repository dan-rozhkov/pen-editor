import { useMemo } from "react";
import type {
  FrameNode,
  GroupNode,
  RefNode,
  SceneNode,
  TextNode,
} from "@/types/scene";
import type { InstanceContext } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import {
  findEffectiveThemeInTree,
  findNodeById,
  findParentFrame,
  getThemeFromAncestorFrames,
  getNodeAbsolutePosition,
  getNodeAbsolutePositionWithLayout,
} from "@/utils/nodeUtils";
import {
  findDescendantLocalPosition,
  getPreparedNodeEffectiveSize,
  prepareInstanceNode,
} from "@/components/nodes/instanceUtils";

interface CanvasSelectionDataParams {
  nodes: SceneNode[];
  visibleNodes: SceneNode[];
  selectedIds: string[];
  editingNodeId: string | null;
  editingMode: "text" | "name" | null;
  instanceContext: InstanceContext | null;
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[];
}

export function useCanvasSelectionData({
  nodes,
  visibleNodes,
  selectedIds,
  editingNodeId,
  editingMode,
  instanceContext,
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

  const parentById = useSceneStore((state) => state.parentById);
  const nodesById = useSceneStore((state) => state.nodesById);
  const activeTheme = useThemeStore((state) => state.activeTheme);
  const isInComponentContext = useMemo(
    () => (nodeId: string): boolean => {
      let currentId: string | null = nodeId;
      while (currentId) {
        const currentNode = nodesById[currentId];
        if (!currentNode) break;
        if (currentNode.type === "ref") return true;
        if (currentNode.type === "frame" && currentNode.reusable) return true;
        currentId = parentById[currentId] ?? null;
      }
      return false;
    },
    [nodesById, parentById],
  );

  const transformerColor = useMemo(() => {
    const defaultColor = "#0d99ff";
    const componentColor = "#9747ff";

    for (const id of selectedIds) {
      if (isInComponentContext(id)) {
        return componentColor;
      }
    }
    return defaultColor;
  }, [selectedIds, isInComponentContext]);

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

  const editingTextTheme = useMemo(() => {
    if (!editingTextNode) return null;
    return getThemeFromAncestorFrames(
      parentById,
      nodesById,
      editingTextNode.id,
      activeTheme,
    );
  }, [editingTextNode, parentById, nodesById, activeTheme]);

  // Descendant text editing: compute the effective text node and its absolute position
  const editingDescendantTextNode = useMemo(() => {
    if (editingMode !== "text" || !instanceContext) return null;
    const instance = findNodeById(nodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return null;
    const preparedInstance = prepareInstanceNode(
      instance as RefNode,
      nodes,
      calculateLayoutForFrame,
    );
    if (!preparedInstance) return null;

    const descendantNode = findNodeById(
      preparedInstance.layoutChildren,
      instanceContext.descendantId,
    );
    if (!descendantNode || descendantNode.type !== "text") return null;
    return descendantNode as TextNode;
  }, [editingMode, instanceContext, nodes]);

  const editingDescendantTextPosition = useMemo(() => {
    if (!editingDescendantTextNode || !instanceContext) return null;
    const instanceAbsPos = getNodeAbsolutePositionWithLayout(
      nodes,
      instanceContext.instanceId,
      calculateLayoutForFrame,
    );
    if (!instanceAbsPos) return null;
    const instance = findNodeById(nodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return null;
    const preparedInstance = prepareInstanceNode(
      instance as RefNode,
      nodes,
      calculateLayoutForFrame,
    );
    if (!preparedInstance) return null;

    const localPos = findDescendantLocalPosition(
      preparedInstance.layoutChildren,
      instanceContext.descendantId,
    );
    if (!localPos) return null;
    return {
      x: instanceAbsPos.x + localPos.x,
      y: instanceAbsPos.y + localPos.y,
    };
  }, [editingDescendantTextNode, instanceContext, nodes, calculateLayoutForFrame]);

  const editingDescendantTextTheme = useMemo(() => {
    if (!editingDescendantTextNode || !instanceContext) return null;
    const instanceTheme = getThemeFromAncestorFrames(
      parentById,
      nodesById,
      instanceContext.instanceId,
      activeTheme,
    );
    const instance = findNodeById(nodes, instanceContext.instanceId);
    if (!instance || instance.type !== "ref") return instanceTheme;
    const preparedInstance = prepareInstanceNode(
      instance as RefNode,
      nodes,
      calculateLayoutForFrame,
    );
    if (!preparedInstance) return instanceTheme;
    const baseTheme = preparedInstance.component.themeOverride ?? instanceTheme;
    return (
      findEffectiveThemeInTree(
        preparedInstance.layoutChildren,
        instanceContext.descendantId,
        baseTheme,
      ) ?? baseTheme
    );
  }, [
    editingDescendantTextNode,
    instanceContext,
    parentById,
    nodesById,
    activeTheme,
    nodes,
    calculateLayoutForFrame,
  ]);

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
      isInComponentContext: boolean;
    }> = [];

    if (selectedIds.length === 0) return result;

    if (instanceContext) {
      const instance = findNodeById(nodes, instanceContext.instanceId);
      if (instance && instance.type === "ref") {
        const refNode = instance as RefNode;
        const preparedInstance = prepareInstanceNode(
          refNode,
          nodes,
          calculateLayoutForFrame,
        );
        if (preparedInstance) {
          const descendantNode = findNodeById(
            preparedInstance.layoutChildren,
            instanceContext.descendantId,
          );

          if (descendantNode) {
            const instanceAbsPos = getNodeAbsolutePositionWithLayout(
              nodes,
              instanceContext.instanceId,
              calculateLayoutForFrame,
            );
            const localPos = findDescendantLocalPosition(
              preparedInstance.layoutChildren,
              instanceContext.descendantId,
            );
            if (instanceAbsPos && localPos) {
              result.push({
                node: descendantNode,
                absX: instanceAbsPos.x + localPos.x,
                absY: instanceAbsPos.y + localPos.y,
                effectiveWidth: descendantNode.width,
                effectiveHeight: descendantNode.height,
                isInComponentContext: true,
              });
              return result;
            }
          }
        }
      }
    }

    for (const id of selectedIds) {
      const node = findNodeById(nodes, id);
      if (!node) continue;

      const absPos = getNodeAbsolutePositionWithLayout(
        nodes,
        id,
        calculateLayoutForFrame,
      );
      if (!absPos) continue;

      let { width: effectiveWidth, height: effectiveHeight } =
        getPreparedNodeEffectiveSize(node, nodes, calculateLayoutForFrame);

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
        isInComponentContext: isInComponentContext(id),
      });
    }
    return result;
  }, [selectedIds, nodes, calculateLayoutForFrame, instanceContext, isInComponentContext]);

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
      isInComponentContext: collectSelectedNodes.some(
        ({ isInComponentContext: inComponent }) => inComponent,
      ),
    };
  }, [collectSelectedNodes]);

  return {
    editingTextNode,
    editingNameNode,
    editingTextPosition,
    editingTextTheme,
    editingNamePosition,
    editingDescendantTextNode,
    editingDescendantTextPosition,
    editingDescendantTextTheme,
    transformerColor,
    collectFrameNodes,
    collectSelectedNodes,
    selectionBoundingBox,
  };
}
