import { useEffect, useRef } from "react";
import Konva from "konva";
import { Ellipse, Group, Rect, Text } from "react-konva";
import type {
  DescendantOverrides,
  FrameNode,
  GroupNode,
  RefNode,
  SceneNode,
} from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useDragStore } from "@/store/dragStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";
import { buildKonvaGradientProps } from "@/utils/gradientUtils";
import { findComponentById } from "@/utils/nodeUtils";
import {
  COMPONENT_HOVER_OUTLINE_COLOR,
  ImageFillLayer,
  SelectionOutline,
  applyDescendantOverride,
  buildKonvaFontStyle,
  buildTextDecoration,
  getEllipseTransformProps,
  getRectTransformProps,
  getTextDimensions,
  isNodeEnabled,
} from "./renderUtils";

interface InstanceRendererProps {
  node: RefNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: (e: Konva.KonvaEventObject<Event>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  effectiveTheme: ThemeName;
  isHovered: boolean;
}

export function InstanceRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformStart,
  onTransform,
  onTransformEnd,
  effectiveTheme,
  isHovered,
}: InstanceRendererProps) {
  const nodes = useSceneStore((state) => state.getNodes());
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const isDragging = useDragStore((state) => state.isDragging);

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
  const effectiveFillOpacity =
    node.fillOpacity !== undefined ? node.fillOpacity : component.fillOpacity;
  const effectiveStrokeOpacity =
    node.strokeOpacity !== undefined ? node.strokeOpacity : component.strokeOpacity;

  const rawFillColor = resolveColor(
    effectiveFill,
    effectiveFillBinding,
    variables,
    currentTheme,
  );
  const rawStrokeColor = resolveColor(
    effectiveStroke,
    effectiveStrokeBinding,
    variables,
    currentTheme,
  );
  const fillColor = rawFillColor ? applyOpacity(rawFillColor, effectiveFillOpacity) : rawFillColor;
  const strokeColor = rawStrokeColor ? applyOpacity(rawStrokeColor, effectiveStrokeOpacity) : rawStrokeColor;
  const effectiveGradientFill = node.gradientFill !== undefined ? node.gradientFill : component.gradientFill;
  const instanceGradientProps = effectiveGradientFill
    ? buildKonvaGradientProps(effectiveGradientFill, node.width, node.height)
    : undefined;

  // Calculate layout for children if auto-layout is enabled
  const layoutChildren = component.layout?.autoLayout
    ? calculateLayoutForFrame(component)
    : component.children;

  const instanceRef = useRef<Konva.Group | null>(null);
  const shouldCache =
    !isDragging && !isInEditMode && layoutChildren.length >= 30;

  useEffect(() => {
    const group = instanceRef.current;
    if (!group) return;
    if (!shouldCache) {
      group.clearCache();
      return;
    }
    group.cache({ pixelRatio: 1 });
  }, [shouldCache, node, layoutChildren]);

  // If component has a theme override, use it for children
  const childTheme = component.themeOverride ?? currentTheme;

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
    }

    // Not in edit mode: render normally with overrides
    return (
      <RenderNodeWithOverrides
        key={`${node.id}-${child.id}`}
        node={overriddenChild}
        effectiveTheme={childTheme}
        descendantOverrides={override?.descendants}
      />
    );
  };

  return (
    <Group
      ref={instanceRef}
      id={node.id}
      name="selectable"
      {...getRectTransformProps(node)}
      opacity={node.opacity ?? 1}
      draggable={!isInEditMode}
      onClick={onClick}
      onTap={onClick}
      onDblClick={handleDblClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
    >
      {/* Background rect with merged properties (instance overrides component) */}
      <Rect
        width={node.width}
        height={node.height}
        perfectDrawEnabled={false}
        fill={instanceGradientProps ? undefined : fillColor}
        {...(instanceGradientProps ?? {})}
        stroke={strokeColor}
        strokeWidth={effectiveStrokeWidth}
        cornerRadius={component.cornerRadius}
      />
      {/* Children from component (rendered at original sizes, like a frame) */}
      {layoutChildren.map(renderDescendant)}
      {/* Instance edit mode indicator */}
      {isInEditMode && (
        <SelectionOutline
          x={0}
          y={0}
          width={node.width}
          height={node.height}
          stroke="#8B5CF6"
          strokeWidth={2}
          dash={[4, 4]}
        />
      )}
      {/* Hover outline */}
      {isHovered && !isInEditMode && (
        <SelectionOutline
          x={0}
          y={0}
          width={node.width}
          height={node.height}
          stroke={COMPONENT_HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
          cornerRadius={component.cornerRadius}
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

  const rawFillColor = resolveColor(
    node.fill,
    node.fillBinding,
    variables,
    currentTheme,
  );
  const rawStrokeColor = resolveColor(
    node.stroke,
    node.strokeBinding,
    variables,
    currentTheme,
  );
  const fillColor = rawFillColor ? applyOpacity(rawFillColor, node.fillOpacity) : rawFillColor;
  const strokeColor = rawStrokeColor ? applyOpacity(rawStrokeColor, node.strokeOpacity) : rawStrokeColor;
  const gradientProps = node.gradientFill
    ? buildKonvaGradientProps(node.gradientFill, node.width, node.height, node.type === "ellipse")
    : undefined;

  // Selection highlight stroke
  const selectionStroke = isSelected ? "#8B5CF6" : undefined;
  const selectionStrokeWidth = isSelected ? 2 : undefined;

  switch (node.type) {
    case "rect": {
      const rectTransform = getRectTransformProps(node);
      return (
        <Group>
          <Rect
            {...rectTransform}
            perfectDrawEnabled={false}
            fill={node.imageFill || gradientProps ? undefined : fillColor}
            {...(gradientProps && !node.imageFill ? gradientProps : {})}
            stroke={strokeColor ?? selectionStroke}
            strokeWidth={node.strokeWidth ?? selectionStrokeWidth}
            cornerRadius={node.cornerRadius}
            opacity={node.opacity ?? 1}
            onClick={onClick}
            onTap={onClick}
          />
          {node.imageFill && (
            <ImageFillLayer
              imageFill={node.imageFill}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              cornerRadius={node.cornerRadius}
              clipType="rect"
            />
          )}
          {isSelected && !strokeColor && (
            <SelectionOutline
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              flipX={node.flipX}
              flipY={node.flipY}
            />
          )}
        </Group>
      );
    }
    case "ellipse": {
      const ellipseTransform = getEllipseTransformProps(node);
      return (
        <Group>
          <Ellipse
            {...ellipseTransform}
            perfectDrawEnabled={false}
            fill={node.imageFill || gradientProps ? undefined : fillColor}
            {...(gradientProps && !node.imageFill ? gradientProps : {})}
            stroke={strokeColor ?? selectionStroke}
            strokeWidth={node.strokeWidth ?? selectionStrokeWidth}
            opacity={node.opacity ?? 1}
            onClick={onClick}
            onTap={onClick}
          />
          {node.imageFill && (
            <ImageFillLayer
              imageFill={node.imageFill}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              clipType="ellipse"
            />
          )}
          {isSelected && !strokeColor && (
            <SelectionOutline
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              shape="ellipse"
            />
          )}
        </Group>
      );
    }
    case "text": {
      const { width: descTextWidth, height: descTextHeight } =
        getTextDimensions(node);
      const textTransform = getRectTransformProps(node);
      const descTextDecoration = buildTextDecoration(node);
      return (
        <Group>
          <Text
            {...textTransform}
            perfectDrawEnabled={false}
            width={descTextWidth}
            height={descTextHeight ?? node.height}
            text={node.text}
            fontSize={node.fontSize ?? 16}
            fontFamily={node.fontFamily ?? "Arial"}
            fontStyle={buildKonvaFontStyle(node)}
            textDecoration={descTextDecoration}
            fill={gradientProps ? undefined : (fillColor ?? "#000000")}
            {...(gradientProps ?? {})}
            align={node.textAlign ?? "left"}
            verticalAlign={node.textAlignVertical ?? "top"}
            lineHeight={node.lineHeight ?? 1.2}
            letterSpacing={node.letterSpacing ?? 0}
            opacity={node.opacity ?? 1}
            onClick={onClick}
            onTap={onClick}
          />
          {isSelected && (
            <SelectionOutline
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rotation={node.rotation ?? 0}
              flipX={node.flipX}
              flipY={node.flipY}
            />
          )}
        </Group>
      );
    }
    case "frame":
    case "group": {
      // For frames/groups, recursively render children with nested overrides
      const handleChildClick =
        (childId: string) =>
        (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
          e.cancelBubble = true;
          selectDescendant(instanceId, childId);
        };
      const containerChildren = (node as FrameNode | GroupNode).children;
      return (
        <Group
          {...getRectTransformProps(node)}
          opacity={node.opacity ?? 1}
          onClick={onClick}
          onTap={onClick}
        >
          {node.type === "frame" && (
            <Rect
              width={node.width}
              height={node.height}
              perfectDrawEnabled={false}
              fill={node.imageFill || gradientProps ? undefined : fillColor}
              {...(gradientProps && !node.imageFill ? gradientProps : {})}
              stroke={strokeColor ?? selectionStroke}
              strokeWidth={node.strokeWidth ?? selectionStrokeWidth}
              cornerRadius={(node as FrameNode).cornerRadius}
            />
          )}
          {node.type === "frame" && node.imageFill && (
            <ImageFillLayer
              imageFill={node.imageFill}
              width={node.width}
              height={node.height}
              cornerRadius={(node as FrameNode).cornerRadius}
              clipType="rect"
            />
          )}
          {containerChildren.map((child) => {
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
            <SelectionOutline
              x={0}
              y={0}
              width={node.width}
              height={node.height}
              stroke="#8B5CF6"
              strokeWidth={2}
            />
          )}
        </Group>
      );
    }
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

  const rawFillColor = resolveColor(
    node.fill,
    node.fillBinding,
    variables,
    currentTheme,
  );
  const rawStrokeColor = resolveColor(
    node.stroke,
    node.strokeBinding,
    variables,
    currentTheme,
  );
  const fillColor = rawFillColor ? applyOpacity(rawFillColor, node.fillOpacity) : rawFillColor;
  const strokeColor = rawStrokeColor ? applyOpacity(rawStrokeColor, node.strokeOpacity) : rawStrokeColor;
  const ovrGradientProps = node.gradientFill
    ? buildKonvaGradientProps(node.gradientFill, node.width, node.height, node.type === "ellipse")
    : undefined;

  // Don't render if node is hidden
  if (node.visible === false || node.enabled === false) {
    return null;
  }

  switch (node.type) {
    case "rect": {
      const rectTransform = getRectTransformProps(node);
      return (
        <>
          <Rect
            {...rectTransform}
            perfectDrawEnabled={false}
            fill={node.imageFill || ovrGradientProps ? undefined : fillColor}
            {...(ovrGradientProps && !node.imageFill ? ovrGradientProps : {})}
            stroke={strokeColor}
            strokeWidth={node.strokeWidth}
            cornerRadius={node.cornerRadius}
            opacity={node.opacity ?? 1}
          />
          {node.imageFill && (
            <ImageFillLayer
              imageFill={node.imageFill}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              cornerRadius={node.cornerRadius}
              clipType="rect"
            />
          )}
        </>
      );
    }
    case "ellipse": {
      const ellipseTransform = getEllipseTransformProps(node);
      return (
        <>
          <Ellipse
            {...ellipseTransform}
            perfectDrawEnabled={false}
            fill={node.imageFill || ovrGradientProps ? undefined : fillColor}
            {...(ovrGradientProps && !node.imageFill ? ovrGradientProps : {})}
            stroke={strokeColor}
            strokeWidth={node.strokeWidth}
            opacity={node.opacity ?? 1}
          />
          {node.imageFill && (
            <ImageFillLayer
              imageFill={node.imageFill}
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              clipType="ellipse"
            />
          )}
        </>
      );
    }
    case "text": {
      const { width: ovrTextWidth, height: ovrTextHeight } =
        getTextDimensions(node);
      const textTransform = getRectTransformProps(node);
      const ovrTextDecoration = buildTextDecoration(node);
      return (
        <Text
          {...textTransform}
          perfectDrawEnabled={false}
          width={ovrTextWidth}
          height={ovrTextHeight ?? node.height}
          text={node.text}
          fontSize={node.fontSize ?? 16}
          fontFamily={node.fontFamily ?? "Arial"}
          fontStyle={buildKonvaFontStyle(node)}
          textDecoration={ovrTextDecoration}
          fill={ovrGradientProps ? undefined : (fillColor ?? "#000000")}
          {...(ovrGradientProps ?? {})}
          align={node.textAlign ?? "left"}
          verticalAlign={node.textAlignVertical ?? "top"}
          lineHeight={node.lineHeight ?? 1.2}
          letterSpacing={node.letterSpacing ?? 0}
          opacity={node.opacity ?? 1}
        />
      );
    }
    case "frame":
    case "group": {
      // Render frame/group children with nested overrides
      const ovrChildren = (node as FrameNode | GroupNode).children;
      return (
        <Group {...getRectTransformProps(node)} opacity={node.opacity ?? 1}>
          {node.type === "frame" && (
            <Rect
              width={node.width}
              height={node.height}
              perfectDrawEnabled={false}
              fill={node.imageFill || ovrGradientProps ? undefined : fillColor}
              {...(ovrGradientProps && !node.imageFill ? ovrGradientProps : {})}
              stroke={strokeColor}
              strokeWidth={node.strokeWidth}
              cornerRadius={(node as FrameNode).cornerRadius}
            />
          )}
          {node.type === "frame" && node.imageFill && (
            <ImageFillLayer
              imageFill={node.imageFill}
              width={node.width}
              height={node.height}
              cornerRadius={(node as FrameNode).cornerRadius}
              clipType="rect"
            />
          )}
          {ovrChildren.map((child) => {
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
    }
    default:
      return null;
  }
}
