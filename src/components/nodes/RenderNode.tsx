import { memo, useRef, useMemo, useCallback } from "react";
import Konva from "konva";
import type {
  FrameNode,
  GroupNode,
  LineNode,
  PathNode,
  PolygonNode,
  RefNode,
  SceneNode,
} from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { EllipseRenderer } from "@/components/nodes/EllipseRenderer";
import { FrameRenderer } from "@/components/nodes/FrameRenderer";
import { GroupRenderer } from "@/components/nodes/GroupRenderer";
import { InstanceRenderer } from "@/components/nodes/InstanceRenderer";
import { LineRenderer } from "@/components/nodes/LineRenderer";
import { PathRenderer } from "@/components/nodes/PathRenderer";
import { PolygonRenderer } from "@/components/nodes/PolygonRenderer";
import { RectRenderer } from "@/components/nodes/RectRenderer";
import { TextRenderer } from "@/components/nodes/TextRenderer";
import { useDragStore } from "@/store/dragStore";
import { useHoverStore } from "@/store/hoverStore";
import { useHistoryStore } from "@/store/historyStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";
import { buildKonvaGradientProps } from "@/utils/gradientUtils";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import { buildKonvaShadowProps } from "@/utils/shadowUtils";
import {
  calculateDropPosition,
  getFrameAbsoluteRectWithLayout,
  handleAutoLayoutDragEnd,
  isPointInsideRect,
} from "@/utils/dragUtils";
import type { ParentContext } from "@/utils/nodeUtils";
import {
  getNodeAbsolutePosition,
} from "@/utils/nodeUtils";
import {
  collectSnapTargets,
  getSnapEdges,
  calculateSnap,
  type SnapTarget,
} from "@/utils/smartGuideUtils";

const AXIS_LOCK_THRESHOLD = 8; // pixels

interface RenderNodeProps {
  node: SceneNode;
  effectiveTheme?: ThemeName; // Theme inherited from parent or global
  selectOverrideId?: string; // If set, clicking this node selects this ID instead (nested selection)
}

export const RenderNode = memo(function RenderNode({
  node,
  effectiveTheme,
  selectOverrideId,
}: RenderNodeProps) {
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const select = useSelectionStore((state) => state.select);
  const addToSelection = useSelectionStore((state) => state.addToSelection);
  const startEditing = useSelectionStore((state) => state.startEditing);
  const isSelected = useSelectionStore((state) =>
    state.selectedIds.includes(node.id),
  );
  const isEditingText = useSelectionStore(
    (state) => state.editingMode === "text" && state.editingNodeId === node.id,
  );
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const isHovered = useHoverStore(
    (state) => state.hoveredNodeId === node.id,
  );

  // Refs for caching snap data during drag
  const snapTargetsRef = useRef<SnapTarget[]>([]);
  const parentOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const snapOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const transformUpdateRef = useRef<Partial<SceneNode> | null>(null);
  const transformRafRef = useRef<number | null>(null);

  // Axis lock state
  const axisLockStateRef = useRef<{
    isShiftHeld: boolean;
    axisLock: "x" | "y" | null;
    dragStartX: number;
    dragStartY: number;
  }>({
    isShiftHeld: false,
    axisLock: null,
    dragStartX: 0,
    dragStartY: 0,
  });

  // Refs for stable callbacks - avoids recreating handlers on every prop change
  const nodeRef = useRef(node);
  nodeRef.current = node;
  const selectOverrideIdRef = useRef(selectOverrideId);
  selectOverrideIdRef.current = selectOverrideId;
  const isSelectedRef = useRef(isSelected);
  isSelectedRef.current = isSelected;

  const scheduleTransformUpdate = useCallback((updates: Partial<SceneNode>) => {
    transformUpdateRef.current = updates;
    if (transformRafRef.current !== null) return;
    transformRafRef.current = requestAnimationFrame(() => {
      transformRafRef.current = null;
      const pending = transformUpdateRef.current;
      if (pending) {
        updateNode(nodeRef.current.id, pending);
      }
    });
  }, [updateNode]);

  // Use effective theme from parent, or fall back to global theme
  const currentTheme = effectiveTheme ?? globalTheme;

  // Find parent context using O(1) indexed lookup instead of O(n) tree traversal
  const parentId = useSceneStore((state) => state.parentById[node.id] ?? null);
  const parentNode = useSceneStore((state) =>
    parentId ? (state.nodesById[parentId] as FrameNode | GroupNode | null) : null,
  );
  const parentContext: ParentContext = useMemo(() => ({
    parent: parentNode ?? null,
    isInsideAutoLayout:
      (parentNode?.type === "frame" && (parentNode as FrameNode)?.layout?.autoLayout) ?? false,
  }), [parentNode]);
  const isInAutoLayout = parentContext.isInsideAutoLayout;
  const parentFrame = parentContext.parent;

  // Refs for parent context (used in drag handlers - avoids callback recreation)
  const isInAutoLayoutRef = useRef(isInAutoLayout);
  isInAutoLayoutRef.current = isInAutoLayout;
  const parentFrameRef = useRef(parentFrame);
  parentFrameRef.current = parentFrame;

  // Resolved colors for this node (with per-color opacity applied)
  const { fillColor, strokeColor } = useMemo(() => {
    const rawFill = resolveColor(
      node.fill,
      node.fillBinding,
      variables,
      currentTheme,
    );
    const rawStroke = resolveColor(
      node.stroke,
      node.strokeBinding,
      variables,
      currentTheme,
    );
    return {
      fillColor: rawFill ? applyOpacity(rawFill, node.fillOpacity) : rawFill,
      strokeColor: rawStroke
        ? applyOpacity(rawStroke, node.strokeOpacity)
        : rawStroke,
    };
  }, [
    node.fill,
    node.fillBinding,
    node.fillOpacity,
    node.stroke,
    node.strokeBinding,
    node.strokeOpacity,
    variables,
    currentTheme,
  ]);

  // Shadow effect props
  const shadowProps = useMemo(
    () => buildKonvaShadowProps(node.effect),
    [node.effect],
  );

  // Gradient fill props (takes priority over solid fill)
  const gradientProps = useMemo(
    () =>
      node.gradientFill
        ? buildKonvaGradientProps(
            node.gradientFill,
            node.width,
            node.height,
            node.type === "ellipse",
          )
        : undefined,
    [node.gradientFill, node.width, node.height, node.type],
  );

  // Don't render if node is hidden
  if (node.visible === false) {
    return null;
  }

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const n = nodeRef.current;
    const isMeta = "metaKey" in e.evt && (e.evt.metaKey || e.evt.ctrlKey);
    const currentSelectedIds = useSelectionStore.getState().selectedIds;
    const isAlreadySelected = currentSelectedIds.includes(n.id);
    // Cmd/Ctrl+Click bypasses selectOverrideId to deep-select the actual clicked node
    const selectId = isMeta
      ? n.id
      : isAlreadySelected
      ? n.id
      : selectOverrideIdRef.current ?? n.id;
    const isShift = "shiftKey" in e.evt && e.evt.shiftKey;
    if (isShift) {
      addToSelection(selectId);
    } else {
      select(selectId);
    }
  }, [select, addToSelection]);


  // Check if node is hovered (and not selected - selected takes priority)
  const isHoveredAndNotSelected = isHovered && !isSelected;

  const handleDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const n = nodeRef.current;
    const target = e.target;

    // Always select the node when starting to drag
    select(n.id);

    // Capture Shift state and initial position
    axisLockStateRef.current = {
      isShiftHeld: e.evt.shiftKey,
      axisLock: null,
      dragStartX: target.x(),
      dragStartY: target.y(),
    };

    if (isInAutoLayoutRef.current) {
      useDragStore.getState().startDrag(n.id);
    } else {
      // Use imperative getState() to avoid subscribing to entire tree
      const currentNodes = useSceneStore.getState().getNodes();

      // Compute parent offset for absolute position calculation
      const absPos = getNodeAbsolutePosition(currentNodes, n.id);
      if (absPos) {
        parentOffsetRef.current = {
          x: absPos.x - n.x,
          y: absPos.y - n.y,
        };
      } else {
        parentOffsetRef.current = { x: 0, y: 0 };
      }

      // Reset snap offset
      snapOffsetRef.current = { x: 0, y: 0 };

      // Collect snap targets from all nodes except the dragged one(s)
      const currentSelectedIds = useSelectionStore.getState().selectedIds;
      const excludeIds = new Set(currentSelectedIds);
      snapTargetsRef.current = collectSnapTargets(currentNodes, excludeIds);
    }
  }, [select]);

  const handleDragMove = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    const n = nodeRef.current;
    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== n.id) return;

    const pFrame = parentFrameRef.current;
    if (isInAutoLayoutRef.current && pFrame && pFrame.type === "frame") {
      // Auto-layout drag: reordering logic (no snapping)
      const stage = target.getStage();
      if (!stage) return;

      const pointerPos = stage.getRelativePointerPosition();
      if (!pointerPos) return;

      // Get absolute position of parent frame (imperative to avoid subscription)
      const currentNodes = useSceneStore.getState().getNodes();
      const calcLayout = useLayoutStore.getState().calculateLayoutForFrame;
      const frameRect = getFrameAbsoluteRectWithLayout(
        pFrame,
        currentNodes,
        calcLayout,
      );

      // Check if cursor is inside parent frame
      const isInsideParent = isPointInsideRect(pointerPos, frameRect);

      if (isInsideParent) {
        // Get layout-calculated children positions (from Yoga) for correct indicator placement
        // This is important when justify is center/end - raw children have x=0, y=0
        const layoutChildren = pFrame.layout?.autoLayout
          ? calcLayout(pFrame)
          : pFrame.children;

        // Calculate drop position for reordering
        const dropResult = calculateDropPosition(
          pointerPos,
          pFrame,
          { x: frameRect.x, y: frameRect.y },
          n.id,
          layoutChildren,
        );

        if (dropResult) {
          useDragStore.getState().updateDrop(dropResult.indicator, dropResult.insertInfo, false);
        }
      } else {
        // Outside parent - will move to root level
        useDragStore.getState().updateDrop(null, null, true);
      }
    } else {
      // Free drag: apply smart guide snapping
      const targets = snapTargetsRef.current;

      // No targets to snap to — skip snap logic entirely
      if (targets.length === 0) {
        useSmartGuideStore.getState().clearGuides();
        return;
      }

      const scale = useViewportStore.getState().scale;
      const threshold = 2 / scale;

      // Undo previous snap offset to get the "intended" (mouse-following) position
      let intendedX = target.x() - snapOffsetRef.current.x;
      let intendedY = target.y() - snapOffsetRef.current.y;

      // Apply axis lock BEFORE snapping
      const axisLock = axisLockStateRef.current;
      if (axisLock.isShiftHeld) {
        const deltaX = intendedX - axisLock.dragStartX;
        const deltaY = intendedY - axisLock.dragStartY;
        const absDeltaX = Math.abs(deltaX);
        const absDeltaY = Math.abs(deltaY);
        const totalMovement = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

        // Below threshold: freeze at start position
        if (totalMovement < AXIS_LOCK_THRESHOLD) {
          intendedX = axisLock.dragStartX;
          intendedY = axisLock.dragStartY;
        } else {
          // Above threshold: determine and lock to dominant axis
          if (axisLock.axisLock === null) {
            axisLock.axisLock = absDeltaX >= absDeltaY ? "x" : "y";
          }

          if (axisLock.axisLock === "x") {
            intendedY = axisLock.dragStartY; // Lock Y
          } else {
            intendedX = axisLock.dragStartX; // Lock X
          }
        }
      }

      const absX = intendedX + parentOffsetRef.current.x;
      const absY = intendedY + parentOffsetRef.current.y;

      const draggedEdges = getSnapEdges(absX, absY, n.width, n.height);
      const result = calculateSnap(draggedEdges, targets, threshold);

      // Filter snap deltas and guides based on axis lock
      let snapDeltaX = result.deltaX;
      let snapDeltaY = result.deltaY;
      let filteredGuides = result.guides;

      if (axisLock.isShiftHeld && axisLock.axisLock !== null) {
        if (axisLock.axisLock === "x") {
          snapDeltaY = 0; // Don't snap locked Y axis
          filteredGuides = result.guides.filter(g => g.orientation === "horizontal");
        } else {
          snapDeltaX = 0; // Don't snap locked X axis
          filteredGuides = result.guides.filter(g => g.orientation === "vertical");
        }
      }

      // Apply new snap offset
      snapOffsetRef.current = { x: snapDeltaX, y: snapDeltaY };
      target.x(intendedX + snapDeltaX);
      target.y(intendedY + snapDeltaY);

      if (filteredGuides.length > 0) {
        useSmartGuideStore.getState().setGuides(filteredGuides);
      } else {
        useSmartGuideStore.getState().clearGuides();
      }
    }
  }, []);

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    const n = nodeRef.current;

    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== n.id) return;

    // Always clear smart guides on drag end
    useSmartGuideStore.getState().clearGuides();

    // Reset axis lock state
    axisLockStateRef.current = {
      isShiftHeld: false,
      axisLock: null,
      dragStartX: 0,
      dragStartY: 0,
    };

    if (isInAutoLayoutRef.current && parentFrameRef.current) {
      const { insertInfo, isOutsideParent } = useDragStore.getState();

      handleAutoLayoutDragEnd(
        target,
        n.id,
        n.width,
        n.height,
        insertInfo,
        isOutsideParent,
        moveNode,
        updateNode,
        () => ({ x: n.x, y: n.y }),
      );

      useDragStore.getState().endDrag();
    } else {
      // Normal behavior - update position
      updateNode(n.id, {
        x: Math.round(target.x()),
        y: Math.round(target.y()),
      });
    }
  }, [moveNode, updateNode]);

  const handleTransformStart = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const n = nodeRef.current;
    if (n.type !== "frame") return;
    if (e.target.id() !== n.id) return;
    const history = useHistoryStore.getState();
    history.saveHistory(createSnapshot(useSceneStore.getState()));
    history.startBatch();
    const widthMode = n.sizing?.widthMode ?? "fixed";
    const heightMode = n.sizing?.heightMode ?? "fixed";
    const shouldSwitchWidth =
      widthMode === "fill_container" || widthMode === "fit_content";
    const shouldSwitchHeight =
      heightMode === "fill_container" || heightMode === "fit_content";
    if (shouldSwitchWidth || shouldSwitchHeight) {
      updateNode(n.id, {
        sizing: {
          widthMode: shouldSwitchWidth ? "fixed" : widthMode,
          heightMode: shouldSwitchHeight ? "fixed" : heightMode,
        },
      });
    }
  }, [updateNode]);

  const handleTextTransformStart = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const n = nodeRef.current;
    if (n.type !== "text") return;
    if (e.target.id() !== n.id) return;
    const history = useHistoryStore.getState();
    history.saveHistory(createSnapshot(useSceneStore.getState()));
    history.startBatch();
    if (n.textWidthMode === "auto" || !n.textWidthMode) {
      updateNode(n.id, { textWidthMode: "fixed" });
    }
  }, [updateNode]);

  const handleFrameTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const n = nodeRef.current;
    if (n.type !== "frame") return;
    const target = e.target;
    if (target.id() !== n.id) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();
    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const flipSignX = n.flipX ? -1 : 1;
    const flipSignY = n.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(n.flipX ? newWidth : 0);
    target.offsetY(n.flipY ? newHeight : 0);

    scheduleTransformUpdate({
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  }, []);

  const handleInstanceTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const n = nodeRef.current;
    if (n.type !== "ref") return;
    const target = e.target;
    if (target.id() !== n.id) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();
    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const flipSignX = n.flipX ? -1 : 1;
    const flipSignY = n.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(n.flipX ? newWidth : 0);
    target.offsetY(n.flipY ? newHeight : 0);

    updateNode(n.id, {
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  }, [updateNode]);

  const handleTextTransform = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const n = nodeRef.current;
    if (n.type !== "text") return;
    const target = e.target;
    if (target.id() !== n.id) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();
    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const flipSignX = n.flipX ? -1 : 1;
    const flipSignY = n.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(n.flipX ? newWidth : 0);
    target.offsetY(n.flipY ? newHeight : 0);

    updateNode(n.id, {
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  }, [updateNode]);

  const handleTransformEnd = useCallback((e: Konva.KonvaEventObject<Event>) => {
    const target = e.target;
    const n = nodeRef.current;
    if (n.type === "frame") {
      if (transformRafRef.current !== null) {
        cancelAnimationFrame(transformRafRef.current);
        transformRafRef.current = null;
      }
      if (transformUpdateRef.current) {
        updateNode(n.id, transformUpdateRef.current);
      }
      const flipSignX = n.flipX ? -1 : 1;
      const flipSignY = n.flipY ? -1 : 1;
      target.scaleX(flipSignX);
      target.scaleY(flipSignY);
      target.offsetX(n.flipX ? n.width : 0);
      target.offsetY(n.flipY ? n.height : 0);
      useHistoryStore.getState().endBatch();
      return;
    }
    if (n.type === "text") {
      const flipSignX = n.flipX ? -1 : 1;
      const flipSignY = n.flipY ? -1 : 1;
      target.scaleX(flipSignX);
      target.scaleY(flipSignY);
      target.offsetX(n.flipX ? n.width : 0);
      target.offsetY(n.flipY ? n.height : 0);
      useHistoryStore.getState().endBatch();
      return;
    }
    if (n.type === "ref") {
      const flipSignX = n.flipX ? -1 : 1;
      const flipSignY = n.flipY ? -1 : 1;
      target.scaleX(flipSignX);
      target.scaleY(flipSignY);
      target.offsetX(n.flipX ? n.width : 0);
      target.offsetY(n.flipY ? n.height : 0);
      useHistoryStore.getState().endBatch();
      return;
    }
    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();

    // Preserve flip state: use absolute scale for sizing, reset to flip sign
    const flipSignX = n.flipX ? -1 : 1;
    const flipSignY = n.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(n.flipX ? target.width() : 0);
    target.offsetY(n.flipY ? target.height() : 0);

    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const updates: Partial<SceneNode> = {
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    };

    // Recalculate points for line/polygon nodes to match new dimensions
    if (n.type === "line") {
      const ln = n as LineNode;
      const scaleFactorX = newWidth / n.width;
      const scaleFactorY = newHeight / n.height;
      const newPoints = ln.points.map((v, i) =>
        i % 2 === 0 ? v * scaleFactorX : v * scaleFactorY,
      );
      (updates as Partial<LineNode>).points = newPoints;
    } else if (n.type === "polygon") {
      const pn = n as PolygonNode;
      const sides = pn.sides ?? 6;
      (updates as Partial<PolygonNode>).points = generatePolygonPoints(sides, newWidth, newHeight);
    }

    updateNode(n.id, updates);
  }, [updateNode]);

  const handleTextDblClick = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    // If this text node is not directly selectable (deep nested),
    // don't start editing unless it's already selected via deep-select
    if (selectOverrideIdRef.current && !isSelectedRef.current) return;
    e.cancelBubble = true;
    startEditing(nodeRef.current.id);
  }, [startEditing]);

  switch (node.type) {
    case "frame":
      return (
        <FrameRenderer
          node={node}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformStart={handleTransformStart}
          onTransform={handleFrameTransform}
          onTransformEnd={handleTransformEnd}
          fillColor={fillColor}
          strokeColor={strokeColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          effectiveTheme={currentTheme}
          isHovered={isHoveredAndNotSelected}
          isTopLevel={parentFrame === null}
          selectOverrideId={selectOverrideId}
        />
      );
    case "group": {
      return (
        <GroupRenderer
          node={node as GroupNode}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
          effectiveTheme={currentTheme}
          isHovered={isHoveredAndNotSelected}
          isTopLevel={parentFrame === null}
          selectOverrideId={selectOverrideId}
        />
      );
    }
    case "rect":
      return (
        <RectRenderer
          node={node}
          fillColor={fillColor}
          strokeColor={strokeColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          isHovered={isHoveredAndNotSelected}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      );
    case "ellipse":
      return (
        <EllipseRenderer
          node={node}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          fillColor={fillColor}
          strokeColor={strokeColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          isInAutoLayout={isInAutoLayout}
          parentFrame={parentFrame?.type === "frame" ? parentFrame : null}
          isHovered={isHoveredAndNotSelected}
        />
      );
    case "text": {
      return (
        <TextRenderer
          node={node}
          fillColor={fillColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          isHovered={isHoveredAndNotSelected}
          isEditing={isEditingText}
          onClick={handleClick}
          onDblClick={handleTextDblClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformStart={handleTextTransformStart}
          onTransform={handleTextTransform}
          onTransformEnd={handleTransformEnd}
        />
      );
    }
    case "path":
      return (
        <PathRenderer
          node={node as PathNode}
          fillColor={fillColor}
          strokeColor={strokeColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          isHovered={isHoveredAndNotSelected}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      );
    case "line":
      return (
        <LineRenderer
          node={node as LineNode}
          strokeColor={strokeColor}
          shadowProps={shadowProps}
          isHovered={isHoveredAndNotSelected}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      );
    case "polygon":
      return (
        <PolygonRenderer
          node={node as PolygonNode}
          fillColor={fillColor}
          strokeColor={strokeColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          isHovered={isHoveredAndNotSelected}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
      );
    case "ref":
      return (
        <InstanceRenderer
          node={node as RefNode}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformStart={handleTransformStart}
          onTransform={handleInstanceTransform}
          onTransformEnd={handleTransformEnd}
          effectiveTheme={currentTheme}
          isHovered={isHoveredAndNotSelected}
        />
      );
    default:
      return null;
  }
});
