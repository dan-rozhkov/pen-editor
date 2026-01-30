import { useEffect } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { isContainerNode } from "@/types/scene";
import {
  findChildAtPosition,
  findNodeById,
  getNodeAbsolutePosition,
} from "@/utils/nodeUtils";

interface CanvasDoubleClickParams {
  containerRef: RefObject<HTMLDivElement | null>;
  stageRef: RefObject<Konva.Stage | null>;
  enterContainer: (id: string) => void;
  select: (id: string) => void;
}

export function useCanvasDoubleClick({
  containerRef,
  stageRef,
  enterContainer,
  select,
}: CanvasDoubleClickParams) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleDblClick = (e: MouseEvent) => {
      const currentSelectedIds = useSelectionStore.getState().selectedIds;
      const currentNodes = useSceneStore.getState().nodes;

      if (currentSelectedIds.length !== 1) return;
      const selectedNode = findNodeById(currentNodes, currentSelectedIds[0]);
      if (!selectedNode || !isContainerNode(selectedNode)) return;

      const stage = stageRef.current;
      if (!stage) return;

      const stageBox = stage.container().getBoundingClientRect();
      const stageScale = stage.scaleX();
      const stagePos = stage.position();
      const sceneX = (e.clientX - stageBox.left - stagePos.x) / stageScale;
      const sceneY = (e.clientY - stageBox.top - stagePos.y) / stageScale;

      enterContainer(selectedNode.id);

      const absPos = getNodeAbsolutePosition(currentNodes, selectedNode.id);
      if (!absPos) return;
      const localX = sceneX - absPos.x;
      const localY = sceneY - absPos.y;

      const childId = findChildAtPosition(selectedNode.children, localX, localY);
      if (childId) {
        select(childId);
      }
    };

    container.addEventListener("dblclick", handleDblClick);
    return () => container.removeEventListener("dblclick", handleDblClick);
  }, [containerRef, enterContainer, select, stageRef]);
}
