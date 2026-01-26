import { Rect, Ellipse, Text, Group } from "react-konva";
import Konva from "konva";
import type {
  SceneNode,
  FrameNode,
  RefNode,
  DescendantOverrides,
  DescendantOverride,
} from "../../types/scene";
import type { ThemeName } from "../../types/variable";
import { getVariableValue } from "../../types/variable";
import { useSceneStore } from "../../store/sceneStore";
import { useSelectionStore } from "../../store/selectionStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useVariableStore } from "../../store/variableStore";
import { useThemeStore } from "../../store/themeStore";
import { useDragStore } from "../../store/dragStore";
import { useHoverStore } from "../../store/hoverStore";
import { findParentFrame, findComponentById } from "../../utils/nodeUtils";
import {
  calculateDropPosition,
  isPointInsideRect,
  getFrameAbsoluteRectWithLayout,
} from "../../utils/dragUtils";

// Figma-style hover outline color
const HOVER_OUTLINE_COLOR = "#0d99ff";

// Apply descendant overrides to a node
function applyDescendantOverride(
  node: SceneNode,
  override?: DescendantOverride,
): SceneNode {
  if (!override) return node;
  // Apply override properties (excluding nested descendants)
  const { descendants: _, ...overrideProps } = override;
  return { ...node, ...overrideProps } as SceneNode;
}

// Check if a node should be rendered (considering enabled property)
function isNodeEnabled(override?: DescendantOverride): boolean {
  return override?.enabled !== false;
}

interface RenderNodeProps {
  node: SceneNode;
  effectiveTheme?: ThemeName; // Theme inherited from parent or global
}

export function RenderNode({ node, effectiveTheme }: RenderNodeProps) {
  const nodes = useSceneStore((state) => state.nodes);
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const { select, addToSelection, startEditing, editingNodeId } =
    useSelectionStore();
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const { startDrag, updateDrop, endDrag } = useDragStore();
  const { hoveredNodeId, setHoveredNode } = useHoverStore();
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );

  // Use effective theme from parent, or fall back to global theme
  const currentTheme = effectiveTheme ?? globalTheme;

  // Find parent context to check if inside auto-layout
  const parentContext = findParentFrame(nodes, node.id);
  const isInAutoLayout = parentContext.isInsideAutoLayout;
  const parentFrame = parentContext.parent;

  // Resolve color from variable binding or use direct value
  const resolveColor = (
    color: string | undefined,
    binding?: { variableId: string },
  ): string | undefined => {
    if (binding) {
      const variable = variables.find((v) => v.id === binding.variableId);
      if (variable) {
        return getVariableValue(variable, currentTheme);
      }
    }
    return color;
  };

  // Resolved colors for this node
  const fillColor = resolveColor(node.fill, node.fillBinding);
  const strokeColor = resolveColor(node.stroke, node.strokeBinding);

  // Don't render if node is hidden
  if (node.visible === false) {
    return null;
  }

  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    const isShift = "shiftKey" in e.evt && e.evt.shiftKey;
    if (isShift) {
      addToSelection(node.id);
    } else {
      select(node.id);
    }
  };

  const handleMouseEnter = () => {
    setHoveredNode(node.id);
  };

  const handleMouseLeave = () => {
    setHoveredNode(null);
  };

  // Check if node is hovered (and not selected - selected takes priority)
  const { selectedIds } = useSelectionStore();
  const isHovered = hoveredNodeId === node.id && !selectedIds.includes(node.id);

  const handleDragStart = () => {
    if (isInAutoLayout) {
      startDrag(node.id);
    }
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target
    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== node.id) return;

    if (!isInAutoLayout || !parentFrame) return;

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
  };

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;

    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== node.id) return;

    if (isInAutoLayout && parentFrame) {
      const { insertInfo, isOutsideParent } = useDragStore.getState();

      if (isOutsideParent) {
        // Drag out of auto-layout frame - move to root level
        const stage = target.getStage();
        if (stage) {
          const pointerPos = stage.getRelativePointerPosition();
          if (pointerPos) {
            // Move to root level first
            moveNode(node.id, null, 0);
            // Then set position in world coordinates
            updateNode(node.id, {
              x: pointerPos.x - node.width / 2,
              y: pointerPos.y - node.height / 2,
            });
          }
        }
        // Don't reset position - updateNode already set the new position
      } else if (insertInfo) {
        // Reorder within the frame
        moveNode(node.id, insertInfo.parentId, insertInfo.index);
      }

      // Reset Konva target position to let React re-render with layout-calculated positions
      target.x(node.x);
      target.y(node.y);
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

    // Reset scale and apply to width/height
    target.scaleX(1);
    target.scaleY(1);

    updateNode(node.id, {
      x: target.x(),
      y: target.y(),
      width: Math.max(5, target.width() * scaleX),
      height: Math.max(5, target.height() * scaleY),
      rotation: rotation,
    });
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
        />
      );
    case "rect":
      return (
        <>
          <Rect
            id={node.id}
            name="selectable"
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rotation={node.rotation ?? 0}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={node.strokeWidth}
            cornerRadius={node.cornerRadius}
            draggable
            onClick={handleClick}
            onTap={handleClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onTransformEnd={handleTransformEnd}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
          {/* Hover outline */}
          {isHovered && (
            <Rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              stroke={HOVER_OUTLINE_COLOR}
              strokeWidth={1.5}
              cornerRadius={node.cornerRadius}
              listening={false}
            />
          )}
        </>
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
          parentFrame={parentFrame}
          isHovered={isHovered}
        />
      );
    case "text": {
      const isEditing = editingNodeId === node.id;
      const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
        e.cancelBubble = true;
        startEditing(node.id);
      };
      // For auto width mode, don't set width to let Konva calculate it from text
      const textWidth = node.textWidthMode === "auto" ? undefined : node.width;
      return (
        <>
          <Text
            id={node.id}
            name="selectable"
            x={node.x}
            y={node.y}
            width={textWidth}
            height={node.height}
            rotation={node.rotation ?? 0}
            text={node.text}
            fontSize={node.fontSize ?? 16}
            fontFamily={node.fontFamily ?? "Arial"}
            fill={fillColor ?? "#000000"}
            align={node.textAlign ?? "left"}
            lineHeight={node.lineHeight ?? 1.2}
            letterSpacing={node.letterSpacing ?? 0}
            opacity={isEditing ? 0 : 1}
            draggable={!isEditing}
            onClick={handleClick}
            onTap={handleClick}
            onDblClick={handleDblClick}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
            onTransformEnd={handleTransformEnd}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
          {/* Hover outline */}
          {isHovered && (
            <Rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              stroke={HOVER_OUTLINE_COLOR}
              strokeWidth={1.5}
              listening={false}
            />
          )}
        </>
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

interface EllipseRendererProps {
  node: SceneNode & { type: "ellipse" };
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  fillColor?: string;
  strokeColor?: string;
  isInAutoLayout: boolean;
  parentFrame: FrameNode | null;
  isHovered: boolean;
}

function EllipseRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onMouseEnter,
  onMouseLeave,
  fillColor,
  strokeColor,
  isInAutoLayout,
  parentFrame,
  isHovered,
}: EllipseRendererProps) {
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const { endDrag } = useDragStore();

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;

    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== node.id) return;

    if (isInAutoLayout && parentFrame) {
      const { insertInfo, isOutsideParent } = useDragStore.getState();

      if (isOutsideParent) {
        // Drag out of auto-layout frame
        const stage = target.getStage();
        if (stage) {
          const pointerPos = stage.getRelativePointerPosition();
          if (pointerPos) {
            moveNode(node.id, null, 0);
            updateNode(node.id, {
              x: pointerPos.x - node.width / 2,
              y: pointerPos.y - node.height / 2,
            });
          }
        }
      } else if (insertInfo) {
        moveNode(node.id, insertInfo.parentId, insertInfo.index);
      }

      // Reset position - Ellipse uses center
      target.x(node.x + node.width / 2);
      target.y(node.y + node.height / 2);
      endDrag();
    } else {
      // Ellipse position is center, convert back to top-left
      updateNode(node.id, {
        x: target.x() - node.width / 2,
        y: target.y() - node.height / 2,
      });
    }
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target as Konva.Ellipse;
    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();

    const newWidth = Math.max(5, target.radiusX() * 2 * scaleX);
    const newHeight = Math.max(5, target.radiusY() * 2 * scaleY);

    // Reset scale
    target.scaleX(1);
    target.scaleY(1);

    // Update radiuses
    target.radiusX(newWidth / 2);
    target.radiusY(newHeight / 2);

    updateNode(node.id, {
      x: target.x() - newWidth / 2,
      y: target.y() - newHeight / 2,
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  };

  return (
    <>
      <Ellipse
        id={node.id}
        name="selectable"
        x={node.x + node.width / 2}
        y={node.y + node.height / 2}
        radiusX={node.width / 2}
        radiusY={node.height / 2}
        rotation={node.rotation ?? 0}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={node.strokeWidth}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
      {/* Hover outline */}
      {isHovered && (
        <Ellipse
          x={node.x + node.width / 2}
          y={node.y + node.height / 2}
          radiusX={node.width / 2}
          radiusY={node.height / 2}
          rotation={node.rotation ?? 0}
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
          listening={false}
        />
      )}
    </>
  );
}

interface FrameRendererProps {
  node: FrameNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  fillColor?: string;
  strokeColor?: string;
  effectiveTheme: ThemeName;
  isHovered: boolean;
}

function FrameRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
  fillColor,
  strokeColor,
  effectiveTheme,
  isHovered,
}: FrameRendererProps) {
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );

  // Calculate layout for children if auto-layout is enabled
  const layoutChildren = node.layout?.autoLayout
    ? calculateLayoutForFrame(node)
    : node.children;

  // If this frame has a theme override, use it for children
  const childTheme = node.themeOverride ?? effectiveTheme;

  return (
    <Group
      id={node.id}
      name="selectable"
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      rotation={node.rotation ?? 0}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <Rect
        width={node.width}
        height={node.height}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={node.strokeWidth}
        cornerRadius={node.cornerRadius}
      />
      {layoutChildren.map((child) => (
        <RenderNode key={child.id} node={child} effectiveTheme={childTheme} />
      ))}
      {/* Hover outline */}
      {isHovered && (
        <Rect
          width={node.width}
          height={node.height}
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
          cornerRadius={node.cornerRadius}
          listening={false}
        />
      )}
    </Group>
  );
}

interface InstanceRendererProps {
  node: RefNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  effectiveTheme: ThemeName;
  isHovered: boolean;
}

function InstanceRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
  effectiveTheme,
  isHovered,
}: InstanceRendererProps) {
  const nodes = useSceneStore((state) => state.nodes);
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);

  // Instance edit mode state
  const editingInstanceId = useSelectionStore(
    (state) => state.editingInstanceId,
  );
  const instanceContext = useSelectionStore((state) => state.instanceContext);
  const enterInstanceEditMode = useSelectionStore(
    (state) => state.enterInstanceEditMode,
  );
  const selectDescendant = useSelectionStore((state) => state.selectDescendant);

  // Check if we are in edit mode for this instance
  const isInEditMode = editingInstanceId === node.id;

  // Find the component this instance references
  const component = findComponentById(nodes, node.componentId);

  // Don't render if component not found
  if (!component) {
    return null;
  }

  // Use effective theme or fall back to global theme
  const currentTheme = effectiveTheme ?? globalTheme;

  // Resolve color from variable binding
  const resolveColor = (
    color: string | undefined,
    binding?: { variableId: string },
  ): string | undefined => {
    if (binding) {
      const variable = variables.find((v) => v.id === binding.variableId);
      if (variable) {
        return getVariableValue(variable, currentTheme);
      }
    }
    return color;
  };

  // Merge instance properties with component defaults (instance takes priority)
  const effectiveFill = node.fill !== undefined ? node.fill : component.fill;
  const effectiveFillBinding =
    node.fillBinding !== undefined ? node.fillBinding : component.fillBinding;
  const effectiveStroke =
    node.stroke !== undefined ? node.stroke : component.stroke;
  const effectiveStrokeBinding =
    node.strokeBinding !== undefined
      ? node.strokeBinding
      : component.strokeBinding;
  const effectiveStrokeWidth =
    node.strokeWidth !== undefined ? node.strokeWidth : component.strokeWidth;

  const fillColor = resolveColor(effectiveFill, effectiveFillBinding);
  const strokeColor = resolveColor(effectiveStroke, effectiveStrokeBinding);

  // Calculate layout for children if auto-layout is enabled
  const layoutChildren = component.layout?.autoLayout
    ? calculateLayoutForFrame(component)
    : component.children;

  // If component has a theme override, use it for children
  const childTheme = component.themeOverride ?? currentTheme;

  // Calculate scale to fit component content into instance size
  const scaleX = node.width / component.width;
  const scaleY = node.height / component.height;

  // Get descendant overrides
  const descendantOverrides = node.descendants || {};

  // Handle double-click to enter instance edit mode
  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    enterInstanceEditMode(node.id);
  };

  // Handle click on descendant (only in edit mode)
  const handleDescendantClick =
    (childId: string) =>
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      selectDescendant(node.id, childId);
    };

  // Render a descendant with overrides applied
  const renderDescendant = (child: SceneNode) => {
    const override = descendantOverrides[child.id];

    // Check if this descendant is disabled (hidden via override)
    if (!isNodeEnabled(override)) {
      return null;
    }

    // Apply overrides to the child node
    const overriddenChild = applyDescendantOverride(child, override);

    // Check if this descendant is selected
    const isSelected =
      instanceContext?.instanceId === node.id &&
      instanceContext?.descendantId === child.id;

    if (isInEditMode) {
      // In edit mode: render with click handlers and selection highlight
      return (
        <Group key={`${node.id}-${child.id}`}>
          <DescendantRenderer
            node={overriddenChild}
            onClick={handleDescendantClick(child.id)}
            isSelected={isSelected}
            effectiveTheme={childTheme}
            descendantOverrides={override?.descendants}
            instanceId={node.id}
          />
        </Group>
      );
    } else {
      // Not in edit mode: render normally with overrides
      return (
        <RenderNodeWithOverrides
          key={`${node.id}-${child.id}`}
          node={overriddenChild}
          effectiveTheme={childTheme}
          descendantOverrides={override?.descendants}
        />
      );
    }
  };

  return (
    <Group
      id={node.id}
      name="selectable"
      x={node.x}
      y={node.y}
      width={node.width}
      height={node.height}
      rotation={node.rotation ?? 0}
      draggable={!isInEditMode}
      onClick={onClick}
      onTap={onClick}
      onDblClick={handleDblClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Background rect with merged properties (instance overrides component) */}
      <Rect
        width={node.width}
        height={node.height}
        fill={fillColor}
        stroke={strokeColor}
        strokeWidth={effectiveStrokeWidth}
        cornerRadius={component.cornerRadius}
      />
      {/* Scaled content from component */}
      <Group scaleX={scaleX} scaleY={scaleY}>
        {layoutChildren.map(renderDescendant)}
      </Group>
      {/* Instance edit mode indicator */}
      {isInEditMode && (
        <Rect
          width={node.width}
          height={node.height}
          stroke="#8B5CF6"
          strokeWidth={2}
          dash={[4, 4]}
          listening={false}
        />
      )}
      {/* Hover outline */}
      {isHovered && !isInEditMode && (
        <Rect
          width={node.width}
          height={node.height}
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
          cornerRadius={component.cornerRadius}
          listening={false}
        />
      )}
    </Group>
  );
}

// Renderer for descendant nodes in instance edit mode
interface DescendantRendererProps {
  node: SceneNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  isSelected: boolean;
  effectiveTheme: ThemeName;
  descendantOverrides?: DescendantOverrides;
  instanceId: string;
}

function DescendantRenderer({
  node,
  onClick,
  isSelected,
  effectiveTheme,
  descendantOverrides,
  instanceId,
}: DescendantRendererProps) {
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const currentTheme = effectiveTheme ?? globalTheme;
  const selectDescendant = useSelectionStore((state) => state.selectDescendant);

  // Resolve color from variable binding
  const resolveColor = (
    color: string | undefined,
    binding?: { variableId: string },
  ): string | undefined => {
    if (binding) {
      const variable = variables.find((v) => v.id === binding.variableId);
      if (variable) {
        return getVariableValue(variable, currentTheme);
      }
    }
    return color;
  };

  const fillColor = resolveColor(node.fill, node.fillBinding);
  const strokeColor = resolveColor(node.stroke, node.strokeBinding);

  // Selection highlight stroke
  const selectionStroke = isSelected ? "#8B5CF6" : undefined;
  const selectionStrokeWidth = isSelected ? 2 : undefined;

  switch (node.type) {
    case "rect":
      return (
        <Group>
          <Rect
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            rotation={node.rotation ?? 0}
            fill={fillColor}
            stroke={strokeColor ?? selectionStroke}
            strokeWidth={node.strokeWidth ?? selectionStrokeWidth}
            cornerRadius={node.cornerRadius}
            onClick={onClick}
            onTap={onClick}
          />
          {isSelected && !strokeColor && (
            <Rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              stroke="#8B5CF6"
              strokeWidth={2}
              listening={false}
            />
          )}
        </Group>
      );
    case "ellipse":
      return (
        <Group>
          <Ellipse
            x={node.x + node.width / 2}
            y={node.y + node.height / 2}
            radiusX={node.width / 2}
            radiusY={node.height / 2}
            rotation={node.rotation ?? 0}
            fill={fillColor}
            stroke={strokeColor ?? selectionStroke}
            strokeWidth={node.strokeWidth ?? selectionStrokeWidth}
            onClick={onClick}
            onTap={onClick}
          />
          {isSelected && !strokeColor && (
            <Ellipse
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              radiusX={node.width / 2}
              radiusY={node.height / 2}
              rotation={node.rotation ?? 0}
              stroke="#8B5CF6"
              strokeWidth={2}
              listening={false}
            />
          )}
        </Group>
      );
    case "text":
      const textWidth = node.textWidthMode === "auto" ? undefined : node.width;
      return (
        <Group>
          <Text
            x={node.x}
            y={node.y}
            width={textWidth}
            height={node.height}
            rotation={node.rotation ?? 0}
            text={node.text}
            fontSize={node.fontSize ?? 16}
            fontFamily={node.fontFamily ?? "Arial"}
            fill={fillColor ?? "#000000"}
            align={node.textAlign ?? "left"}
            lineHeight={node.lineHeight ?? 1.2}
            letterSpacing={node.letterSpacing ?? 0}
            onClick={onClick}
            onTap={onClick}
          />
          {isSelected && (
            <Rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              stroke="#8B5CF6"
              strokeWidth={2}
              listening={false}
            />
          )}
        </Group>
      );
    case "frame":
      // For frames, recursively render children with nested overrides
      const handleChildClick =
        (childId: string) =>
        (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
          e.cancelBubble = true;
          selectDescendant(instanceId, childId);
        };
      return (
        <Group
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rotation={node.rotation ?? 0}
          onClick={onClick}
          onTap={onClick}
        >
          <Rect
            width={node.width}
            height={node.height}
            fill={fillColor}
            stroke={strokeColor ?? selectionStroke}
            strokeWidth={node.strokeWidth ?? selectionStrokeWidth}
            cornerRadius={node.cornerRadius}
          />
          {node.children.map((child) => {
            const childOverride = descendantOverrides?.[child.id];
            if (!isNodeEnabled(childOverride)) return null;
            const overriddenChild = applyDescendantOverride(
              child,
              childOverride,
            );
            const childIsSelected = false; // Nested selection not yet supported
            return (
              <DescendantRenderer
                key={child.id}
                node={overriddenChild}
                onClick={handleChildClick(child.id)}
                isSelected={childIsSelected}
                effectiveTheme={effectiveTheme}
                descendantOverrides={childOverride?.descendants}
                instanceId={instanceId}
              />
            );
          })}
          {isSelected && !strokeColor && (
            <Rect
              width={node.width}
              height={node.height}
              stroke="#8B5CF6"
              strokeWidth={2}
              listening={false}
            />
          )}
        </Group>
      );
    default:
      return null;
  }
}

// RenderNode variant that applies descendant overrides (for non-edit mode)
interface RenderNodeWithOverridesProps {
  node: SceneNode;
  effectiveTheme: ThemeName;
  descendantOverrides?: DescendantOverrides;
}

function RenderNodeWithOverrides({
  node,
  effectiveTheme,
  descendantOverrides,
}: RenderNodeWithOverridesProps) {
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const currentTheme = effectiveTheme ?? globalTheme;

  // Resolve color from variable binding
  const resolveColor = (
    color: string | undefined,
    binding?: { variableId: string },
  ): string | undefined => {
    if (binding) {
      const variable = variables.find((v) => v.id === binding.variableId);
      if (variable) {
        return getVariableValue(variable, currentTheme);
      }
    }
    return color;
  };

  const fillColor = resolveColor(node.fill, node.fillBinding);
  const strokeColor = resolveColor(node.stroke, node.strokeBinding);

  // Don't render if node is hidden
  if (node.visible === false || node.enabled === false) {
    return null;
  }

  switch (node.type) {
    case "rect":
      return (
        <Rect
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rotation={node.rotation ?? 0}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={node.strokeWidth}
          cornerRadius={node.cornerRadius}
        />
      );
    case "ellipse":
      return (
        <Ellipse
          x={node.x + node.width / 2}
          y={node.y + node.height / 2}
          radiusX={node.width / 2}
          radiusY={node.height / 2}
          rotation={node.rotation ?? 0}
          fill={fillColor}
          stroke={strokeColor}
          strokeWidth={node.strokeWidth}
        />
      );
    case "text":
      const textWidth = node.textWidthMode === "auto" ? undefined : node.width;
      return (
        <Text
          x={node.x}
          y={node.y}
          width={textWidth}
          height={node.height}
          rotation={node.rotation ?? 0}
          text={node.text}
          fontSize={node.fontSize ?? 16}
          fontFamily={node.fontFamily ?? "Arial"}
          fill={fillColor ?? "#000000"}
          align={node.textAlign ?? "left"}
          lineHeight={node.lineHeight ?? 1.2}
          letterSpacing={node.letterSpacing ?? 0}
        />
      );
    case "frame":
      // Render frame children with nested overrides
      return (
        <Group
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rotation={node.rotation ?? 0}
        >
          <Rect
            width={node.width}
            height={node.height}
            fill={fillColor}
            stroke={strokeColor}
            strokeWidth={node.strokeWidth}
            cornerRadius={node.cornerRadius}
          />
          {node.children.map((child) => {
            const childOverride = descendantOverrides?.[child.id];
            if (!isNodeEnabled(childOverride)) return null;
            const overriddenChild = applyDescendantOverride(
              child,
              childOverride,
            );
            return (
              <RenderNodeWithOverrides
                key={child.id}
                node={overriddenChild}
                effectiveTheme={effectiveTheme}
                descendantOverrides={childOverride?.descendants}
              />
            );
          })}
        </Group>
      );
    default:
      return null;
  }
}
