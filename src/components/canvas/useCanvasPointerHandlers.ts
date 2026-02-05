import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type Konva from "konva";
import type { SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useHoverStore } from "@/store/hoverStore";
import { useMeasureStore } from "@/store/measureStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import { rectsIntersect } from "@/utils/dragUtils";
import {
  computeParentDistances,
  computeSiblingDistances,
} from "@/utils/measureUtils";
import {
  findNodeById,
  getNodeAbsolutePositionWithLayout,
  isDescendantOf,
} from "@/utils/nodeUtils";
import { generatePolygonPoints } from "@/utils/polygonUtils";

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
      tool: "frame" | "rect" | "ellipse" | "text" | "line" | "polygon",
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
        case "line":
          node = {
            id,
            type: "line",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            stroke: "#333333",
            strokeWidth: 2,
            points: [0, 0, rw, rh],
          };
          break;
        case "polygon": {
          const sides = 6;
          const points = generatePolygonPoints(sides, rw, rh);
          node = {
            id,
            type: "polygon",
            x: rx,
            y: ry,
            width: rw,
            height: rh,
            fill: "#50b87d",
            sides,
            points,
          };
          break;
        }
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

  // Track previous hover target for delegated mouseenter/mouseleave
  const lastHoverIdRef = useRef<string | null>(null);

  const lastMoveEventRef = useRef<Konva.KonvaEventObject<MouseEvent> | null>(
    null,
  );
  const moveRafRef = useRef<number | null>(null);

  const handleMouseMoveImpl = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      const isDrawing = useDrawModeStore.getState().isDrawing;
      const shouldProcessHover = !isPanning && !isDrawing && !isMarqueeActive.current;
      if (shouldProcessHover) {
        // --- Delegated hover detection ---
        // Walk up from the Konva target to find the nearest "selectable" shape
        let hoveredId: string | null = null;
        let target: Konva.Node | null = e.target;
        while (target && target !== e.target.getStage()) {
          if (target.name() === "selectable" || target.name() === "background") {
            break;
          }
          target = target.parent;
        }
        if (target && target.name() === "selectable") {
          hoveredId = target.id();
        }

        if (hoveredId !== lastHoverIdRef.current) {
          lastHoverIdRef.current = hoveredId;
          useHoverStore.getState().setHoveredNode(hoveredId);

          // Measurement distance computation
          const { modifierHeld, setLines, clearLines } =
            useMeasureStore.getState();
          if (!hoveredId || !modifierHeld) {
            clearLines();
          } else {
            const currentSelectedIds =
              useSelectionStore.getState().selectedIds;
            if (currentSelectedIds.length === 1) {
              const selectedId = currentSelectedIds[0];
              if (selectedId !== hoveredId) {
                const currentNodes = useSceneStore.getState().nodes;
                const calculateLayoutForFrame =
                  useLayoutStore.getState().calculateLayoutForFrame;
                const selectedNode = findNodeById(currentNodes, selectedId);
                if (selectedNode) {
                  const selPos = getNodeAbsolutePositionWithLayout(
                    currentNodes,
                    selectedId,
                    calculateLayoutForFrame,
                  );
                  const hovPos = getNodeAbsolutePositionWithLayout(
                    currentNodes,
                    hoveredId,
                    calculateLayoutForFrame,
                  );
                  if (selPos && hovPos) {
                    const hovNode = findNodeById(currentNodes, hoveredId);
                    const selBounds = {
                      x: selPos.x,
                      y: selPos.y,
                      width: selectedNode.width,
                      height: selectedNode.height,
                    };
                    const hovBounds = {
                      x: hovPos.x,
                      y: hovPos.y,
                      width: hovNode?.width ?? 0,
                      height: hovNode?.height ?? 0,
                    };
                    const isParent = isDescendantOf(
                      currentNodes,
                      hoveredId,
                      selectedId,
                    );
                    if (isParent) {
                      setLines(computeParentDistances(selBounds, hovBounds));
                    } else {
                      setLines(computeSiblingDistances(selBounds, hovBounds));
                    }
                  }
                }
              }
            }
          }
        }
      }

      // --- Drawing mode ---
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

      // --- Marquee selection ---
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

      // --- Panning ---
      if (!isPanning || !lastPointerPosition.current) return;

      const stage = stageRef.current;
      if (!stage) return;

      const pointerPos = stage.getPointerPosition();
      if (!pointerPos) return;

      const dx = pointerPos.x - lastPointerPosition.current.x;
      const dy = pointerPos.y - lastPointerPosition.current.y;

      setPosition(x + dx, y + dy);
      lastPointerPosition.current = pointerPos;
    },
    [isPanning, setPosition, setSelectedIds, stageRef, updateDrawing, x, y],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      lastMoveEventRef.current = e;
      if (moveRafRef.current !== null) return;
      moveRafRef.current = requestAnimationFrame(() => {
        moveRafRef.current = null;
        const evt = lastMoveEventRef.current;
        if (evt) {
          handleMouseMoveImpl(evt);
        }
      });
    },
    [handleMouseMoveImpl],
  );

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

        if (tool === 'cursor') {
          endDrawing();
          return;
        }

        const defaults: Record<string, { w: number; h: number }> = {
          frame: { w: 200, h: 150 },
          rect: { w: 150, h: 100 },
          ellipse: { w: 120, h: 120 },
          text: { w: 100, h: 24 },
          line: { w: 150, h: 2 },
          polygon: { w: 120, h: 120 },
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

  const handleMouseLeave = useCallback(() => {
    lastHoverIdRef.current = null;
    useHoverStore.getState().setHoveredNode(null);
    useMeasureStore.getState().clearLines();
  }, []);

  return {
    drawPreviewRect,
    marqueeRect,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleMouseLeave,
    handleContextMenu,
  };
}
