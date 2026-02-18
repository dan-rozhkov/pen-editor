import { useEffect, useMemo, useRef } from "react";
import Konva from "konva";
import { Ellipse, Group, Path, Rect, Text } from "react-konva";
import type {
  DescendantOverrides,
  FrameNode,
  GroupNode,
  PathNode,
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
  const selectedDescendantIds = useSelectionStore(
    (state) =>
      state.instanceContext?.instanceId === node.id
        ? state.selectedDescendantIds
        : [],
  );
  const selectDescendant = useSelectionStore((state) => state.selectDescendant);
  const selectDescendantRange = useSelectionStore(
    (state) => state.selectDescendantRange,
  );

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

  const flatDescendantIds = useMemo(() => {
    const result: string[] = [];
    const walk = (items: SceneNode[]) => {
      for (const item of items) {
        if (item.visible === false || item.enabled === false) continue;
        result.push(item.id);
        if (item.type === "frame" || item.type === "group") {
          walk(item.children);
        }
      }
    };
    walk(layoutChildren);
    return result;
  }, [layoutChildren]);

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
  const handleDescendantClick = (
    childId: string,
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => {
    e.cancelBubble = true;
    const isShift = "shiftKey" in e.evt && e.evt.shiftKey;
    if (
      isShift &&
      instanceContext?.instanceId === node.id &&
      selectedDescendantIds.length > 0
    ) {
      selectDescendantRange(
        node.id,
        instanceContext.descendantId,
        childId,
        flatDescendantIds,
      );
      return;
    }
    selectDescendant(node.id, childId);
  };

  // Render a descendant with overrides applied
  const renderDescendant = (child: SceneNode) => {
    // Respect both enabled and visible flags for descendants in instance rendering
    if (child.enabled === false || child.visible === false) {
      return null;
    }

    const selectedDescendantIdSet = new Set(selectedDescendantIds);

    if (hasSelectedDescendant) {
      // When entered: render with click handlers and selection highlight
      return (
        <Group key={`${node.id}-${child.id}`}>
          <DescendantRenderer
            node={child}
            onClick={(e) => handleDescendantClick(child.id, e)}
            selectedDescendantIds={selectedDescendantIdSet}
            effectiveTheme={childTheme}
            instanceId={node.id}
            onSelectDescendant={handleDescendantClick}
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
  selectedDescendantIds: Set<string>;
  effectiveTheme: ThemeName;
  instanceId: string;
  onSelectDescendant: (
    childId: string,
    e: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ) => void;
}

function DescendantRenderer({
  node: rawNode,
  onClick,
  selectedDescendantIds,
  effectiveTheme,
  instanceId,
  onSelectDescendant,
}: DescendantRendererProps) {
  const variables = useVariableStore((state) => state.variables);
  const globalTheme = useThemeStore((state) => state.activeTheme);
  const currentTheme = effectiveTheme ?? globalTheme;
  const startDescendantEditing = useSelectionStore((state) => state.startDescendantEditing);

  const node = rawNode;
  if (node.enabled === false || node.visible === false) {
    return null;
  }
  const isSelected = selectedDescendantIds.has(node.id);

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
        <Group id={node.id} name="instance-descendant" dataDescendantId={node.id}>
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
        <Group id={node.id} name="instance-descendant" dataDescendantId={node.id}>
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
        <Group id={node.id} name="instance-descendant" dataDescendantId={node.id}>
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
    case "path": {
      const pathNode = node as PathNode;
      const pathStrokeColor = pathNode.pathStroke?.fill || strokeColor;
      const pathStrokeWidth =
        pathNode.pathStroke?.thickness ?? pathNode.strokeWidth;
      const lineJoin = (pathNode.pathStroke?.join as CanvasLineJoin) ?? "round";
      const lineCap = (pathNode.pathStroke?.cap as CanvasLineCap) ?? "round";
      const rotation = pathNode.rotation ?? 0;
      const geometryBounds = pathNode.geometryBounds;
      const geometryWidth = Math.max(1, geometryBounds?.width ?? pathNode.width);
      const geometryHeight = Math.max(
        1,
        geometryBounds?.height ?? pathNode.height,
      );
      const scaleX = geometryBounds ? pathNode.width / geometryWidth : 1;
      const scaleY = geometryBounds ? pathNode.height / geometryHeight : 1;
      const geoOffsetX = -(geometryBounds?.x ?? 0) * scaleX;
      const geoOffsetY = -(geometryBounds?.y ?? 0) * scaleY;

      return (
        <Group id={node.id} name="instance-descendant" dataDescendantId={node.id}>
          <Group
            x={pathNode.x}
            y={pathNode.y}
            width={pathNode.width}
            height={pathNode.height}
            rotation={rotation}
            offsetX={pathNode.flipX ? pathNode.width : 0}
            offsetY={pathNode.flipY ? pathNode.height : 0}
            scaleX={pathNode.flipX ? -1 : 1}
            scaleY={pathNode.flipY ? -1 : 1}
            opacity={pathNode.opacity ?? 1}
            onClick={onClick}
            onTap={onClick}
            clipFunc={
              pathNode.clipGeometry && pathNode.clipBounds
                ? (ctx) => {
                    const clipOffsetX = -(geometryBounds?.x ?? 0);
                    const clipOffsetY = -(geometryBounds?.y ?? 0);
                    const cb = pathNode.clipBounds!;
                    ctx.rect(
                      (cb.x + clipOffsetX) * scaleX,
                      (cb.y + clipOffsetY) * scaleY,
                      cb.width * scaleX,
                      cb.height * scaleY,
                    );
                  }
                : undefined
            }
          >
            <Rect
              width={pathNode.width}
              height={pathNode.height}
              fill="transparent"
              perfectDrawEnabled={false}
              listening={true}
            />
            <Path
              x={geoOffsetX}
              y={geoOffsetY}
              scaleX={scaleX}
              scaleY={scaleY}
              data={pathNode.geometry}
              perfectDrawEnabled={false}
              fill={gradientProps ? undefined : fillColor}
              fillRule={pathNode.fillRule}
              {...(gradientProps ?? {})}
              stroke={pathStrokeColor}
              strokeWidth={pathStrokeWidth}
              lineJoin={lineJoin}
              lineCap={lineCap}
              listening={false}
            />
          </Group>
          {isSelected && (
            <SelectionOutline
              x={pathNode.x}
              y={pathNode.y}
              width={pathNode.width}
              height={pathNode.height}
              rotation={rotation}
              flipX={pathNode.flipX}
              flipY={pathNode.flipY}
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
          onSelectDescendant(childId, e);
        };
      const containerChildren = (node as FrameNode | GroupNode).children;
      return (
        <Group
          id={node.id}
          name="instance-descendant"
          dataDescendantId={node.id}
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
            if (child.enabled === false || child.visible === false) return null;
            return (
              <DescendantRenderer
                key={child.id}
                node={child}
                onClick={handleChildClick(child.id)}
                selectedDescendantIds={selectedDescendantIds}
                effectiveTheme={effectiveTheme}
                instanceId={instanceId}
                onSelectDescendant={onSelectDescendant}
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
    case "path": {
      const pathNode = node as PathNode;
      const pathStrokeColor = pathNode.pathStroke?.fill || strokeColor;
      const pathStrokeWidth =
        pathNode.pathStroke?.thickness ?? pathNode.strokeWidth;
      const lineJoin = (pathNode.pathStroke?.join as CanvasLineJoin) ?? "round";
      const lineCap = (pathNode.pathStroke?.cap as CanvasLineCap) ?? "round";
      const rotation = pathNode.rotation ?? 0;
      const geometryBounds = pathNode.geometryBounds;
      const geometryWidth = Math.max(1, geometryBounds?.width ?? pathNode.width);
      const geometryHeight = Math.max(
        1,
        geometryBounds?.height ?? pathNode.height,
      );
      const scaleX = geometryBounds ? pathNode.width / geometryWidth : 1;
      const scaleY = geometryBounds ? pathNode.height / geometryHeight : 1;
      const geoOffsetX = -(geometryBounds?.x ?? 0) * scaleX;
      const geoOffsetY = -(geometryBounds?.y ?? 0) * scaleY;

      return (
        <Group
          x={pathNode.x}
          y={pathNode.y}
          width={pathNode.width}
          height={pathNode.height}
          rotation={rotation}
          offsetX={pathNode.flipX ? pathNode.width : 0}
          offsetY={pathNode.flipY ? pathNode.height : 0}
          scaleX={pathNode.flipX ? -1 : 1}
          scaleY={pathNode.flipY ? -1 : 1}
          opacity={pathNode.opacity ?? 1}
          clipFunc={
            pathNode.clipGeometry && pathNode.clipBounds
              ? (ctx) => {
                  const clipOffsetX = -(geometryBounds?.x ?? 0);
                  const clipOffsetY = -(geometryBounds?.y ?? 0);
                  const cb = pathNode.clipBounds!;
                  ctx.rect(
                    (cb.x + clipOffsetX) * scaleX,
                    (cb.y + clipOffsetY) * scaleY,
                    cb.width * scaleX,
                    cb.height * scaleY,
                  );
                }
              : undefined
          }
        >
          <Path
            x={geoOffsetX}
            y={geoOffsetY}
            scaleX={scaleX}
            scaleY={scaleY}
            data={pathNode.geometry}
            perfectDrawEnabled={false}
            fill={ovrGradientProps ? undefined : fillColor}
            fillRule={pathNode.fillRule}
            {...(ovrGradientProps ?? {})}
            stroke={pathStrokeColor}
            strokeWidth={pathStrokeWidth}
            lineJoin={lineJoin}
            lineCap={lineCap}
          />
        </Group>
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
