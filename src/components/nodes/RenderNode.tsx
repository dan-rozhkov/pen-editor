import { memo, useRef, useMemo } from "react";
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
  const nodes = useSceneStore((state) => state.getNodes());
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
  const { startDrag, updateDrop, endDrag } = useDragStore();
  const isHovered = useHoverStore(
    (state) => state.hoveredNodeId === node.id,
  );
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );
  const { setGuides, clearGuides } = useSmartGuideStore();

  // Refs for caching snap data during drag
  const snapTargetsRef = useRef<SnapTarget[]>([]);
  const parentOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const snapOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const transformUpdateRef = useRef<Partial<SceneNode> | null>(null);
  const transformRafRef = useRef<number | null>(null);

  const scheduleTransformUpdate = (updates: Partial<SceneNode>) => {
    transformUpdateRef.current = updates;
    if (transformRafRef.current !== null) return;
    transformRafRef.current = requestAnimationFrame(() => {
      transformRafRef.current = null;
      const pending = transformUpdateRef.current;
      if (pending) {
        updateNode(node.id, pending);
      }
    });
  };

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

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const isMeta = "metaKey" in e.evt && (e.evt.metaKey || e.evt.ctrlKey);
    const currentSelectedIds = useSelectionStore.getState().selectedIds;
    const isAlreadySelected = currentSelectedIds.includes(node.id);
    // Cmd/Ctrl+Click bypasses selectOverrideId to deep-select the actual clicked node
    const selectId = isMeta
      ? node.id
      : isAlreadySelected
      ? node.id
      : selectOverrideId ?? node.id;
    const isShift = "shiftKey" in e.evt && e.evt.shiftKey;
    if (isShift) {
      addToSelection(selectId);
    } else {
      select(selectId);
    }
  };


  // Check if node is hovered (and not selected - selected takes priority)
  const isHoveredAndNotSelected = isHovered && !isSelected;

  const handleDragStart = () => {
    // Always select the node when starting to drag
    select(node.id);

    if (isInAutoLayout) {
      startDrag(node.id);
    } else {
      // Compute parent offset for absolute position calculation
      const absPos = getNodeAbsolutePosition(nodes, node.id);
      if (absPos) {
        parentOffsetRef.current = {
          x: absPos.x - node.x,
          y: absPos.y - node.y,
        };
      } else {
        parentOffsetRef.current = { x: 0, y: 0 };
      }

      // Reset snap offset
      snapOffsetRef.current = { x: 0, y: 0 };

      // Collect snap targets from all nodes except the dragged one(s)
      const currentSelectedIds = useSelectionStore.getState().selectedIds;
      const excludeIds = new Set(currentSelectedIds);
      snapTargetsRef.current = collectSnapTargets(nodes, excludeIds);
    }
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;
    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== node.id) return;

    if (isInAutoLayout && parentFrame && parentFrame.type === "frame") {
      // Auto-layout drag: reordering logic (no snapping)
      const stage = target.getStage();
      if (!stage) return;

      const pointerPos = stage.getRelativePointerPosition();
      if (!pointerPos) return;

      // Get absolute position of parent frame
      const frameRect = getFrameAbsoluteRectWithLayout(
        parentFrame,
        nodes,
        calculateLayoutForFrame,
      );

      // Check if cursor is inside parent frame
      const isInsideParent = isPointInsideRect(pointerPos, frameRect);

      if (isInsideParent) {
        // Get layout-calculated children positions (from Yoga) for correct indicator placement
        // This is important when justify is center/end - raw children have x=0, y=0
        const layoutChildren = parentFrame.layout?.autoLayout
          ? calculateLayoutForFrame(parentFrame)
          : parentFrame.children;

        // Calculate drop position for reordering
        const dropResult = calculateDropPosition(
          pointerPos,
          parentFrame,
          { x: frameRect.x, y: frameRect.y },
          node.id,
          layoutChildren,
        );

        if (dropResult) {
          updateDrop(dropResult.indicator, dropResult.insertInfo, false);
        }
      } else {
        // Outside parent - will move to root level
        updateDrop(null, null, true);
      }
    } else {
      // Free drag: apply smart guide snapping
      const targets = snapTargetsRef.current;

      // No targets to snap to — skip snap logic entirely
      if (targets.length === 0) {
        clearGuides();
        return;
      }

      const scale = useViewportStore.getState().scale;
      const threshold = 2 / scale;

      // Undo previous snap offset to get the "intended" (mouse-following) position
      const intendedX = target.x() - snapOffsetRef.current.x;
      const intendedY = target.y() - snapOffsetRef.current.y;

      const absX = intendedX + parentOffsetRef.current.x;
      const absY = intendedY + parentOffsetRef.current.y;

      const draggedEdges = getSnapEdges(absX, absY, node.width, node.height);
      const result = calculateSnap(draggedEdges, targets, threshold);

      // Apply new snap offset
      snapOffsetRef.current = { x: result.deltaX, y: result.deltaY };
      target.x(intendedX + result.deltaX);
      target.y(intendedY + result.deltaY);

      if (result.guides.length > 0) {
        setGuides(result.guides);
      } else {
        clearGuides();
      }
    }
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;

    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== node.id) return;

    // Always clear smart guides on drag end
    clearGuides();

    if (isInAutoLayout && parentFrame) {
      const { insertInfo, isOutsideParent } = useDragStore.getState();

      handleAutoLayoutDragEnd(
        target,
        node.id,
        node.width,
        node.height,
        insertInfo,
        isOutsideParent,
        moveNode,
        updateNode,
        () => ({ x: node.x, y: node.y }),
      );

      endDrag();
    } else {
      // Normal behavior - update position
      updateNode(node.id, {
        x: Math.round(target.x()),
        y: Math.round(target.y()),
      });
    }
  };

  const handleTransformStart = (e: Konva.KonvaEventObject<Event>) => {
    if (node.type !== "frame") return;
    if (e.target.id() !== node.id) return;
    const history = useHistoryStore.getState();
    history.saveHistory(createSnapshot(useSceneStore.getState()));
    history.startBatch();
    const widthMode = node.sizing?.widthMode ?? "fixed";
    const heightMode = node.sizing?.heightMode ?? "fixed";
    const shouldSwitchWidth =
      widthMode === "fill_container" || widthMode === "fit_content";
    const shouldSwitchHeight =
      heightMode === "fill_container" || heightMode === "fit_content";
    if (shouldSwitchWidth || shouldSwitchHeight) {
      updateNode(node.id, {
        sizing: {
          widthMode: shouldSwitchWidth ? "fixed" : widthMode,
          heightMode: shouldSwitchHeight ? "fixed" : heightMode,
        },
      });
    }
  };

  const handleTextTransformStart = (e: Konva.KonvaEventObject<Event>) => {
    if (node.type !== "text") return;
    if (e.target.id() !== node.id) return;
    const history = useHistoryStore.getState();
    history.saveHistory(createSnapshot(useSceneStore.getState()));
    history.startBatch();
    if (node.textWidthMode === "auto" || !node.textWidthMode) {
      updateNode(node.id, { textWidthMode: "fixed" });
    }
  };

  const handleFrameTransform = (e: Konva.KonvaEventObject<Event>) => {
    if (node.type !== "frame") return;
    const target = e.target;
    if (target.id() !== node.id) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();
    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const flipSignX = node.flipX ? -1 : 1;
    const flipSignY = node.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(node.flipX ? newWidth : 0);
    target.offsetY(node.flipY ? newHeight : 0);

    scheduleTransformUpdate({
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  };

  const handleInstanceTransform = (e: Konva.KonvaEventObject<Event>) => {
    if (node.type !== "ref") return;
    const target = e.target;
    if (target.id() !== node.id) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();
    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const flipSignX = node.flipX ? -1 : 1;
    const flipSignY = node.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(node.flipX ? newWidth : 0);
    target.offsetY(node.flipY ? newHeight : 0);

    updateNode(node.id, {
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  };

  const handleTextTransform = (e: Konva.KonvaEventObject<Event>) => {
    if (node.type !== "text") return;
    const target = e.target;
    if (target.id() !== node.id) return;

    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();
    const newWidth = Math.max(5, target.width() * Math.abs(scaleX));
    const newHeight = Math.max(5, target.height() * Math.abs(scaleY));

    const flipSignX = node.flipX ? -1 : 1;
    const flipSignY = node.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(node.flipX ? newWidth : 0);
    target.offsetY(node.flipY ? newHeight : 0);

    updateNode(node.id, {
      x: target.x(),
      y: target.y(),
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target;
    if (node.type === "frame") {
      if (transformRafRef.current !== null) {
        cancelAnimationFrame(transformRafRef.current);
        transformRafRef.current = null;
      }
      if (transformUpdateRef.current) {
        updateNode(node.id, transformUpdateRef.current);
      }
      const flipSignX = node.flipX ? -1 : 1;
      const flipSignY = node.flipY ? -1 : 1;
      target.scaleX(flipSignX);
      target.scaleY(flipSignY);
      target.offsetX(node.flipX ? node.width : 0);
      target.offsetY(node.flipY ? node.height : 0);
      useHistoryStore.getState().endBatch();
      return;
    }
    if (node.type === "text") {
      const flipSignX = node.flipX ? -1 : 1;
      const flipSignY = node.flipY ? -1 : 1;
      target.scaleX(flipSignX);
      target.scaleY(flipSignY);
      target.offsetX(node.flipX ? node.width : 0);
      target.offsetY(node.flipY ? node.height : 0);
      useHistoryStore.getState().endBatch();
      return;
    }
    if (node.type === "ref") {
      const flipSignX = node.flipX ? -1 : 1;
      const flipSignY = node.flipY ? -1 : 1;
      target.scaleX(flipSignX);
      target.scaleY(flipSignY);
      target.offsetX(node.flipX ? node.width : 0);
      target.offsetY(node.flipY ? node.height : 0);
      useHistoryStore.getState().endBatch();
      return;
    }
    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();

    // Preserve flip state: use absolute scale for sizing, reset to flip sign
    const flipSignX = node.flipX ? -1 : 1;
    const flipSignY = node.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);
    target.offsetX(node.flipX ? target.width() : 0);
    target.offsetY(node.flipY ? target.height() : 0);

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
    if (node.type === "line") {
      const ln = node as LineNode;
      const scaleFactorX = newWidth / node.width;
      const scaleFactorY = newHeight / node.height;
      const newPoints = ln.points.map((v, i) =>
        i % 2 === 0 ? v * scaleFactorX : v * scaleFactorY,
      );
      (updates as Partial<LineNode>).points = newPoints;
    } else if (node.type === "polygon") {
      const pn = node as PolygonNode;
      const sides = pn.sides ?? 6;
      (updates as Partial<PolygonNode>).points = generatePolygonPoints(sides, newWidth, newHeight);
    }

    updateNode(node.id, updates);
  };

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
      const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
        // If this text node is not directly selectable (deep nested),
        // don't start editing unless it's already selected via deep-select
        if (selectOverrideId && !isSelected) return;
        e.cancelBubble = true;
        startEditing(node.id);
      };
      return (
        <TextRenderer
          node={node}
          fillColor={fillColor}
          gradientProps={gradientProps}
          shadowProps={shadowProps}
          isHovered={isHoveredAndNotSelected}
          isEditing={isEditingText}
          onClick={handleClick}
          onDblClick={handleDblClick}
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
