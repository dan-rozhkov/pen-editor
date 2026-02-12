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
import { useHoverStore } from "@/store/hoverStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useThemeStore } from "@/store/themeStore";
import { useVariableStore } from "@/store/variableStore";
import { useDragStore } from "@/store/dragStore";
import { resolveColor, applyOpacity } from "@/utils/colorUtils";
import { buildKonvaGradientProps } from "@/utils/gradientUtils";
import { applyAutoLayoutRecursively } from "@/utils/autoLayoutUtils";
import {
  findDeepestChildAtPosition,
} from "@/utils/nodeUtils";
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
import { findDescendantLocalRect, prepareInstanceNode, resolveRefToFrame } from "./instanceUtils";

interface InstanceRendererProps {
  node: RefNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
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

  // Instance interaction state
  const instanceContext = useSelectionStore((state) => state.instanceContext);
  const selectDescendant = useSelectionStore((state) => state.selectDescendant);

  // Whether a descendant of THIS instance is currently selected
  const hasSelectedDescendant = instanceContext?.instanceId === node.id;

  // Hover state for descendants of this instance (from layers panel)
  const hoveredDescendantId = useHoverStore((state) =>
    state.hoveredInstanceId === node.id ? state.hoveredNodeId : null,
  );

  const preparedInstance = prepareInstanceNode(
    node,
    nodes,
    calculateLayoutForFrame,
  );
  if (!preparedInstance) {
    return null;
  }
  const {
    component,
    layoutChildren,
    effectiveWidth,
    effectiveHeight,
  } = preparedInstance;

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
  const effectiveGradientFill = node.gradientFill !== undefined ? node.gradientFill : component.gradientFill;

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

  const instanceGradientProps = effectiveGradientFill
    ? buildKonvaGradientProps(
        effectiveGradientFill,
        effectiveWidth,
        effectiveHeight,
      )
    : undefined;

  const instanceRef = useRef<Konva.Group | null>(null);
  const shouldCache =
    !isDragging && !hasSelectedDescendant && layoutChildren.length >= 30;

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

  // Find child at pointer position in local coordinates
  const findChildAtPointer = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>): string | null => {
    const stage = e.target.getStage();
    if (!stage) return null;
    const pointer = stage.getPointerPosition();
    if (!pointer) return null;
    const group = instanceRef.current;
    if (!group) return null;
    const transform = group.getAbsoluteTransform().copy().invert();
    const localPos = transform.point(pointer);
    return findDeepestChildAtPosition(layoutChildren, localPos.x, localPos.y);
  };

  // Handle click: Cmd/Ctrl+click deep-selects a descendant (like frames)
  const handleClick = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const isMeta = "metaKey" in e.evt && (e.evt.metaKey || e.evt.ctrlKey);
    if (isMeta) {
      e.cancelBubble = true;
      const childId = findChildAtPointer(e);
      if (childId) {
        selectDescendant(node.id, childId);
      }
      return;
    }
    onClick(e);
  };

  // Handle double-click: enter instance and select child at position
  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // If a descendant is already selected, let descendant handlers take over (e.g. inline text editing)
    if (hasSelectedDescendant) return;

    e.cancelBubble = true;
    const childId = findChildAtPointer(e);
    if (childId) {
      selectDescendant(node.id, childId);
    } else if (layoutChildren.length > 0) {
      selectDescendant(node.id, layoutChildren[0].id);
    }
  };

  // Handle click on descendant (when a descendant is selected, for switching between them)
  const handleDescendantClick =
    (childId: string) =>
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      selectDescendant(node.id, childId);
    };

  // Render a descendant with overrides applied
  const renderDescendant = (child: SceneNode) => {
    // Check if this descendant is disabled (hidden via override)
    if (child.enabled === false) {
      return null;
    }

    const selectedDescendantId =
      instanceContext?.instanceId === node.id
        ? instanceContext.descendantId
        : null;

    if (hasSelectedDescendant) {
      // When entered: render with click handlers and selection highlight
      return (
        <Group key={`${node.id}-${child.id}`}>
          <DescendantRenderer
            node={child}
            onClick={handleDescendantClick(child.id)}
            selectedDescendantId={selectedDescendantId}
            effectiveTheme={childTheme}
            instanceId={node.id}
          />
        </Group>
      );
    }

    // Not entered: render normally with overrides
    return (
      <RenderNodeWithOverrides
        key={`${node.id}-${child.id}`}
        node={child}
        effectiveTheme={childTheme}
      />
    );
  };

  return (
    <Group
      ref={instanceRef}
      id={node.id}
      name="selectable"
      {...getRectTransformProps({
        ...node,
        width: effectiveWidth,
        height: effectiveHeight,
      })}
      opacity={node.opacity ?? 1}
      draggable={!hasSelectedDescendant}
      onClick={handleClick}
      onTap={handleClick}
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
        name="instance-bg"
        width={effectiveWidth}
        height={effectiveHeight}
        perfectDrawEnabled={false}
        fill={instanceGradientProps ? undefined : fillColor}
        {...(instanceGradientProps ?? {})}
        stroke={strokeColor}
        strokeWidth={effectiveStrokeWidth}
        cornerRadius={component.cornerRadius}
      />
      {/* Children from component (rendered at original sizes, like a frame) */}
      {layoutChildren.map(renderDescendant)}
      {/* Descendant hover outline (from layers panel) */}
      {hoveredDescendantId && (() => {
        const rect = findDescendantLocalRect(layoutChildren, hoveredDescendantId);
        if (!rect) return null;
        return (
          <SelectionOutline
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            stroke={COMPONENT_HOVER_OUTLINE_COLOR}
            strokeWidth={1.5}
          />
        );
      })()}
      {/* Hover outline */}
      {isHovered && !hasSelectedDescendant && !hoveredDescendantId && (
        <SelectionOutline
          x={0}
          y={0}
          width={effectiveWidth}
          height={effectiveHeight}
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
  selectedDescendantId: string | null;
  effectiveTheme: ThemeName;
  instanceId: string;
}

function DescendantRenderer({
  node: rawNode,
  onClick,
  selectedDescendantId,
  effectiveTheme,
  instanceId,
}: DescendantRendererProps) {
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const currentTheme = effectiveTheme ?? globalTheme;
  const selectDescendant = useSelectionStore((state) => state.selectDescendant);
  const startDescendantEditing = useSelectionStore((state) => state.startDescendantEditing);

  const node = rawNode;
  const isSelected = selectedDescendantId === node.id;

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
            onDblClick={(e: Konva.KonvaEventObject<MouseEvent>) => {
              e.cancelBubble = true;
              startDescendantEditing();
            }}
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
      // For frames/groups, recursively render children
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
              fill={
                node.imageFill || gradientProps
                  ? undefined
                  : (fillColor ?? "rgba(0,0,0,0.001)")
              }
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
            if (child.enabled === false) return null;
            return (
              <DescendantRenderer
                key={child.id}
                node={child}
                onClick={handleChildClick(child.id)}
                selectedDescendantId={selectedDescendantId}
                effectiveTheme={effectiveTheme}
                instanceId={instanceId}
              />
            );
          })}
          {isSelected && (
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
  rootDescendantOverrides?: DescendantOverrides;
  slotContent?: Record<string, SceneNode>;
}

function RenderNodeWithOverrides({
  node: rawNode,
  effectiveTheme,
  descendantOverrides,
  rootDescendantOverrides,
  slotContent,
}: RenderNodeWithOverridesProps) {
  const allNodes = useSceneStore((state) => state.getNodes());
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );
  const currentTheme = effectiveTheme ?? globalTheme;

  // Resolve ref nodes to frames for rendering
  const node = rawNode.type === 'ref'
    ? resolveRefToFrame(rawNode as RefNode, allNodes) ?? rawNode
    : rawNode;

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
            const childOverride =
              descendantOverrides?.[child.id] ??
              rootDescendantOverrides?.[child.id];
            if (!isNodeEnabled(childOverride)) return null;
            const slotReplacement =
              child.type === "ref" ? slotContent?.[child.id] : undefined;
            let overriddenChild =
              slotReplacement ?? applyDescendantOverride(child, childOverride);
            if (overriddenChild.type === "ref") {
              overriddenChild =
                resolveRefToFrame(overriddenChild as RefNode, allNodes) ??
                overriddenChild;
            }
            const laidOutChild = applyAutoLayoutRecursively(
              overriddenChild,
              calculateLayoutForFrame,
            );
            return (
              <RenderNodeWithOverrides
                key={child.id}
                node={laidOutChild}
                effectiveTheme={effectiveTheme}
                descendantOverrides={childOverride?.descendants}
                rootDescendantOverrides={rootDescendantOverrides}
                slotContent={slotContent}
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
