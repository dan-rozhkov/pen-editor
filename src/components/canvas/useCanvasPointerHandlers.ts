import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import type { SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { rectsIntersect } from "@/utils/dragUtils";

interface CanvasPointerHandlersParams {
  stageRef: RefObject<Konva.Stage | null>;
  isPanning: boolean;
  setIsPanning: (value: boolean) => void;
  setPosition: (x: number, y: number) => void;
  x: number;
  y: number;
  startSmoothZoom: (deltaY: number, pointerX: number, pointerY: number) => void;
  isSpacePressed: boolean;
  setIsMiddleMouseDown: (value: boolean) => void;
  clearSelection: () => void;
  resetContainerContext: () => void;
  setSelectedIds: (ids: string[]) => void;
  addNode: (node: SceneNode) => void;
}

export function useCanvasPointerHandlers({
  stageRef,
  isPanning,
  setIsPanning,
  setPosition,
  x,
  y,
  startSmoothZoom,
  isSpacePressed,
  setIsMiddleMouseDown,
  clearSelection,
  resetContainerContext,
  setSelectedIds,
  addNode,
}: CanvasPointerHandlersParams) {
  const lastPointerPosition = useRef<{ x: number; y: number } | null>(null);
  const isMarqueeActive = useRef(false);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const marqueeShiftHeld = useRef(false);
  const marqueePreShiftIds = useRef<string[]>([]);
  const [marqueeRect, setMarqueeRect] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const {
    activeTool,
    isDrawing,
    drawStart,
    drawCurrent,
    startDrawing,
    updateDrawing,
    endDrawing,
  } = useDrawModeStore();

  const drawPreviewRect = useMemo(() => {
    if (!isDrawing || !drawStart || !drawCurrent) return null;
    return {
      x: Math.min(drawStart.x, drawCurrent.x),
      y: Math.min(drawStart.y, drawCurrent.y),
      width: Math.abs(drawCurrent.x - drawStart.x),
      height: Math.abs(drawCurrent.y - drawStart.y),
    };
  }, [isDrawing, drawStart, drawCurrent]);

  const createNodeFromDraw = useCallback(
    (
      tool: "frame" | "rect" | "ellipse" | "text",
      rx: number,
      ry: number,
      rw: number,
      rh: number,
    ) => {
      const id = generateId();
      let node: SceneNode;
      switch (tool) {
        case "frame":
          node = {
            id,
            type: "frame",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#ffffff",
            stroke: "#cccccc",
            strokeWidth: 1,
            children: [],
          };
          break;
        case "rect":
          node = {
            id,
            type: "rect",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#4a90d9",
            cornerRadius: 4,
          };
          break;
        case "ellipse":
          node = {
            id,
            type: "ellipse",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#d94a4a",
          };
          break;
        case "text":
          node = {
            id,
            type: "text",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            text: "Text",
            fontSize: 18,
            fontFamily: "Arial",
            fontWeight: "normal",
            fill: "#333333",
            textWidthMode: "auto",
          };
          break;
      }
      addNode(node);
      useSelectionStore.getState().select(id);
    },
    [addNode],
  );

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();

      const stage = stageRef.current;
      if (!stage) return;

      if (e.evt.metaKey || e.evt.ctrlKey) {
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;
        startSmoothZoom(e.evt.deltaY, pointerPos.x, pointerPos.y);
      } else {
        const dx = e.evt.shiftKey ? -e.evt.deltaY : -e.evt.deltaX;
        const dy = e.evt.shiftKey ? 0 : -e.evt.deltaY;
        setPosition(x + dx, y + dy);
      }
    },
    [stageRef, setPosition, startSmoothZoom, x, y],
  );

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (e.evt.button === 1) {
        e.evt.preventDefault();
        setIsMiddleMouseDown(true);
        setIsPanning(true);
        const stage = stageRef.current;
        if (stage) {
          lastPointerPosition.current = stage.getPointerPosition();
        }
      } else if (isSpacePressed && e.evt.button === 0) {
        const stage = stageRef.current;
        if (stage) {
          lastPointerPosition.current = stage.getPointerPosition();
        }
      } else if (e.evt.button === 0) {
        if (activeTool) {
          const stage = stageRef.current;
          if (stage) {
            const pos = stage.getRelativePointerPosition();
            if (pos) {
              startDrawing(pos);
            }
          }
          return;
        }

        const clickedOnEmpty =
          e.target === e.target.getStage() || e.target.name() === "background";
        if (clickedOnEmpty) {
          resetContainerContext();
          const stage = stageRef.current;
          if (stage) {
            const pos = stage.getRelativePointerPosition();
            if (pos) {
              isMarqueeActive.current = true;
              marqueeStart.current = pos;
              marqueeShiftHeld.current = e.evt.shiftKey;
              marqueePreShiftIds.current = e.evt.shiftKey
                ? useSelectionStore.getState().selectedIds.slice()
                : [];
              if (!e.evt.shiftKey) {
                clearSelection();
              }
            }
          }
        }
      }
    },
    [
      activeTool,
      clearSelection,
      isSpacePressed,
      resetContainerContext,
      setIsMiddleMouseDown,
      setIsPanning,
      stageRef,
      startDrawing,
    ],
  );

  const handleMouseMove = useCallback(() => {
    if (useDrawModeStore.getState().isDrawing) {
      const stage = stageRef.current;
      if (stage) {
        const pos = stage.getRelativePointerPosition();
        if (pos) {
          updateDrawing(pos);
        }
      }
      return;
    }

    if (isMarqueeActive.current && marqueeStart.current) {
      const stage = stageRef.current;
      if (!stage) return;

      const pos = stage.getRelativePointerPosition();
      if (!pos) return;

      const startPos = marqueeStart.current;
      const rect = {
        x: Math.min(startPos.x, pos.x),
        y: Math.min(startPos.y, pos.y),
        width: Math.abs(pos.x - startPos.x),
        height: Math.abs(pos.y - startPos.y),
      };
      setMarqueeRect(rect);

      const currentNodes = useSceneStore.getState().nodes;
      const intersecting: string[] = [];
      for (const node of currentNodes) {
        if (node.visible === false) continue;
        const nodeRect = {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
        };
        if (rectsIntersect(rect, nodeRect)) {
          intersecting.push(node.id);
        }
      }

      if (marqueeShiftHeld.current) {
        const merged = [
          ...new Set([...marqueePreShiftIds.current, ...intersecting]),
        ];
        setSelectedIds(merged);
      } else {
        setSelectedIds(intersecting);
      }
      return;
    }

    if (!isPanning || !lastPointerPosition.current) return;

    const stage = stageRef.current;
    if (!stage) return;

    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const dx = pointerPos.x - lastPointerPosition.current.x;
    const dy = pointerPos.y - lastPointerPosition.current.y;

    setPosition(x + dx, y + dy);
    lastPointerPosition.current = pointerPos;
  }, [isPanning, setPosition, setSelectedIds, stageRef, updateDrawing, x, y]);

  const handleMouseUp = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const drawState = useDrawModeStore.getState();
      if (
        drawState.isDrawing &&
        drawState.drawStart &&
        drawState.drawCurrent &&
        drawState.activeTool
      ) {
        const tool = drawState.activeTool;
        const s = drawState.drawStart;
        const c = drawState.drawCurrent;
        const dx = Math.abs(c.x - s.x);
        const dy = Math.abs(c.y - s.y);

        const defaults: Record<string, { w: number; h: number }> = {
          frame: { w: 200, h: 150 },
          rect: { w: 150, h: 100 },
          ellipse: { w: 120, h: 120 },
          text: { w: 100, h: 24 },
        };

        let rx: number;
        let ry: number;
        let rw: number;
        let rh: number;
        if (dx < 2 && dy < 2) {
          const d = defaults[tool];
          rw = d.w;
          rh = d.h;
          rx = s.x - rw / 2;
          ry = s.y - rh / 2;
        } else {
          rx = Math.min(s.x, c.x);
          ry = Math.min(s.y, c.y);
          rw = dx;
          rh = dy;
        }

        createNodeFromDraw(tool, rx, ry, rw, rh);
        endDrawing();
        return;
      }

      if (isMarqueeActive.current) {
        isMarqueeActive.current = false;
        marqueeStart.current = null;
        marqueeShiftHeld.current = false;
        marqueePreShiftIds.current = [];
        setMarqueeRect(null);
      }

      if (e.evt.button === 1) {
        setIsMiddleMouseDown(false);
        if (!isSpacePressed) {
          setIsPanning(false);
        }
      }
      lastPointerPosition.current = null;
    },
    [
      createNodeFromDraw,
      endDrawing,
      isSpacePressed,
      setIsMiddleMouseDown,
      setIsPanning,
    ],
  );

  const handleContextMenu = useCallback(
    (e: Konva.KonvaEventObject<PointerEvent>) => {
      e.evt.preventDefault();
    },
    [],
  );

  return {
    drawPreviewRect,
    marqueeRect,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleContextMenu,
  };
}
