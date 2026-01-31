import { useRef } from "react";
import Konva from "konva";
import type { GroupNode, RefNode, SceneNode, TextNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { EllipseRenderer } from "@/components/nodes/EllipseRenderer";
import { FrameRenderer } from "@/components/nodes/FrameRenderer";
import { GroupRenderer } from "@/components/nodes/GroupRenderer";
import { InstanceRenderer } from "@/components/nodes/InstanceRenderer";
import { RectRenderer } from "@/components/nodes/RectRenderer";
import { TextRenderer } from "@/components/nodes/TextRenderer";
import { useDragStore } from "@/store/dragStore";
import { useHoverStore } from "@/store/hoverStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useViewportStore } from "@/store/viewportStore";
import { resolveColor } from "@/utils/colorUtils";
import {
  calculateDropPosition,
  getFrameAbsoluteRectWithLayout,
  handleAutoLayoutDragEnd,
  isPointInsideRect,
} from "@/utils/dragUtils";
import { findParentFrame, getNodeAbsolutePosition } from "@/utils/nodeUtils";
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

export function RenderNode({
  node,
  effectiveTheme,
  selectOverrideId,
}: RenderNodeProps) {
  const nodes = useSceneStore((state) => state.nodes);
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const { select, addToSelection, startEditing, editingNodeId } =
    useSelectionStore();
  const { selectedIds } = useSelectionStore();
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const { startDrag, updateDrop, endDrag } = useDragStore();
  const { hoveredNodeId, setHoveredNode } = useHoverStore();
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );
  const { setGuides, clearGuides } = useSmartGuideStore();

  // Refs for caching snap data during drag
  const snapTargetsRef = useRef<SnapTarget[]>([]);
  const parentOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const snapOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Use effective theme from parent, or fall back to global theme
  const currentTheme = effectiveTheme ?? globalTheme;

  // Find parent context to check if inside auto-layout
  const parentContext = findParentFrame(nodes, node.id);
  const isInAutoLayout = parentContext.isInsideAutoLayout;
  const parentFrame = parentContext.parent;

  // Resolved colors for this node
  const fillColor = resolveColor(
    node.fill,
    node.fillBinding,
    variables,
    currentTheme,
  );
  const strokeColor = resolveColor(
    node.stroke,
    node.strokeBinding,
    variables,
    currentTheme,
  );

  // Don't render if node is hidden
  if (node.visible === false) {
    return null;
  }

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    // Use selectOverrideId if set (nested selection: clicking deep nodes selects their container)
    const selectId = selectOverrideId ?? node.id;
    const isShift = "shiftKey" in e.evt && e.evt.shiftKey;
    if (isShift) {
      addToSelection(selectId);
    } else {
      select(selectId);
    }
  };

  const handleMouseEnter = () => {
    setHoveredNode(node.id);
  };

  const handleMouseLeave = () => {
    setHoveredNode(null);
  };

  // Check if node is hovered (and not selected - selected takes priority)
  const isHovered = hoveredNodeId === node.id && !selectedIds.includes(node.id);

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
      const threshold = 5 / scale;

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
        x: target.x(),
        y: target.y(),
      });
    }
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target;
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

    // When resizing a text node, switch from auto to fixed mode (like Figma)
    if (
      node.type === "text" &&
      (node.textWidthMode === "auto" || !node.textWidthMode)
    ) {
      (updates as Partial<TextNode>).textWidthMode = "fixed";
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
          onTransformEnd={handleTransformEnd}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          fillColor={fillColor}
          strokeColor={strokeColor}
          effectiveTheme={currentTheme}
          isHovered={isHovered}
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
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          effectiveTheme={currentTheme}
          isHovered={isHovered}
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
          isHovered={isHovered}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      );
    case "ellipse":
      return (
        <EllipseRenderer
          node={node}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          fillColor={fillColor}
          strokeColor={strokeColor}
          isInAutoLayout={isInAutoLayout}
          parentFrame={parentFrame?.type === "frame" ? parentFrame : null}
          isHovered={isHovered}
        />
      );
    case "text": {
      const isEditing = editingNodeId === node.id;
      const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
        // If this text node is not directly selectable (deep nested),
        // don't start editing — let the event bubble to parent container
        if (selectOverrideId) return;
        e.cancelBubble = true;
        startEditing(node.id);
      };
      return (
        <TextRenderer
          node={node}
          fillColor={fillColor}
          isHovered={isHovered}
          isEditing={isEditing}
          onClick={handleClick}
          onDblClick={handleDblClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      );
    }
    case "ref":
      return (
        <InstanceRenderer
          node={node as RefNode}
          onClick={handleClick}
          onDragStart={handleDragStart}
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          effectiveTheme={currentTheme}
          isHovered={isHovered}
        />
      );
    default:
      return null;
  }
}

