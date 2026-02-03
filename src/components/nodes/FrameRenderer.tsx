import { useRef, useEffect, useCallback } from "react";
import Konva from "konva";
import { Group, Rect } from "react-konva";
import type { FrameNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  findChildAtPosition,
  getNodeAbsolutePosition,
} from "@/utils/nodeUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import {
  HOVER_OUTLINE_COLOR,
  ImageFillLayer,
  SelectionOutline,
  getChildSelectOverride,
  getRectTransformProps,
} from "./renderUtils";
import { RenderNode } from "./RenderNode";

interface FrameRendererProps {
  node: FrameNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: (e: Konva.KonvaEventObject<Event>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  fillColor?: string;
  strokeColor?: string;
  gradientProps?: Record<string, unknown>;
  shadowProps?: Record<string, unknown>;
  effectiveTheme: ThemeName;
  isHovered: boolean;
  isTopLevel: boolean;
  selectOverrideId?: string;
}

export function FrameRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformStart,
  onTransform,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
  fillColor,
  strokeColor,
  gradientProps,
  shadowProps,
  effectiveTheme,
  isHovered,
  isTopLevel,
  selectOverrideId,
}: FrameRendererProps) {
  const nodes = useSceneStore((state) => state.nodes);
  const { select, enterContainer } = useSelectionStore();
  const enteredContainerId = useSelectionStore(
    (state) => state.enteredContainerId,
  );
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );

  // Calculate layout for children if auto-layout is enabled
  const layoutChildren = node.layout?.autoLayout
    ? calculateLayoutForFrame(node)
    : node.children;

  // Calculate effective size (fit_content uses intrinsic size from Yoga)
  const fitWidth =
    node.sizing?.widthMode === "fit_content" && node.layout?.autoLayout;
  const fitHeight =
    node.sizing?.heightMode === "fit_content" && node.layout?.autoLayout;
  const intrinsicSize =
    fitWidth || fitHeight
      ? calculateFrameIntrinsicSize(node, { fitWidth, fitHeight })
      : { width: node.width, height: node.height };
  const effectiveWidth = fitWidth ? intrinsicSize.width : node.width;
  const effectiveHeight = fitHeight ? intrinsicSize.height : node.height;

  // If this frame has a theme override, use it for children
  const childTheme = node.themeOverride ?? effectiveTheme;

  const childSelectOverride = getChildSelectOverride({
    nodes,
    nodeId: node.id,
    isTopLevel,
    selectOverrideId,
    enteredContainerId,
  });

  const frameTransform = getRectTransformProps({
    x: node.x,
    y: node.y,
    width: effectiveWidth,
    height: effectiveHeight,
    rotation: node.rotation,
    flipX: node.flipX,
    flipY: node.flipY,
  });

  // Store reference to the group for getClientRect override
  const groupRef = useRef<Konva.Group>(null);

  // Callback ref to apply getClientRect override synchronously when Group is attached
  // Always override to return frame bounds only (ignoring children that extend beyond)
  const setGroupRef = useCallback((group: Konva.Group | null) => {
    groupRef.current = group;
    if (!group) return;

    // Override getClientRect to return only frame dimensions (ignoring children that extend beyond)
    // This ensures the Transformer always shows frame bounds, not children bounds
    group.getClientRect = (config) => {
      if (config?.skipTransform) {
        // Return local coordinates (relative to the node itself)
        return {
          x: 0,
          y: 0,
          width: effectiveWidth,
          height: effectiveHeight,
        };
      }
      // Return absolute coordinates
      const absTransform = group.getAbsoluteTransform();
      const point = absTransform.point({ x: 0, y: 0 });
      const scale = group.getAbsoluteScale();
      return {
        x: point.x,
        y: point.y,
        width: effectiveWidth * scale.x,
        height: effectiveHeight * scale.y,
      };
    };
  }, [effectiveWidth, effectiveHeight]);

  // Re-apply override when clip/size changes (for existing groups)
  useEffect(() => {
    if (groupRef.current) {
      setGroupRef(groupRef.current);
    }
  }, [setGroupRef]);

  // Double-click to enter this frame (drill down)
  // NOTE: This handler only fires when the Transformer is NOT active on this node.
  // The main drill-down logic is handled at the Stage level in Canvas.tsx.
  const handleDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    // Only enter if this frame is at a selectable level (not overridden)
    if (selectOverrideId) return;
    enterContainer(node.id);
    // Find and select the child under the cursor
    const stage = e.target.getStage();
    if (!stage) return;
    const pointerPos = stage.getRelativePointerPosition();
    if (!pointerPos) return;
    // Use absolute position to correctly handle nested frames
    const absPos = getNodeAbsolutePosition(nodes, node.id);
    if (!absPos) return;
    const localX = pointerPos.x - absPos.x;
    const localY = pointerPos.y - absPos.y;
    // Use layout-calculated children for accurate hit detection
    const hitChildren = layoutChildren;
    const childId = findChildAtPosition(hitChildren, localX, localY);
    if (childId) {
      select(childId);
      return;
    }
  };

  return (
    <Group
      ref={setGroupRef}
      id={node.id}
      name="selectable"
      {...frameTransform}
      opacity={node.opacity ?? 1}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDblClick={handleDblClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransform={onTransform}
      onTransformEnd={onTransformEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      clipFunc={
        node.clip
          ? (ctx) => {
              const ctx2d = ctx._context;
              if (node.cornerRadius && node.cornerRadius > 0) {
                ctx2d.beginPath();
                (
                  ctx2d as unknown as {
                    roundRect: (
                      x: number,
                      y: number,
                      w: number,
                      h: number,
                      r: number,
                    ) => void;
                  }
                ).roundRect(0, 0, effectiveWidth, effectiveHeight, node.cornerRadius);
                ctx2d.closePath();
              } else {
                ctx2d.rect(0, 0, effectiveWidth, effectiveHeight);
              }
            }
          : undefined
      }
    >
      <Rect
        width={effectiveWidth}
        height={effectiveHeight}
        fill={node.imageFill || gradientProps ? undefined : fillColor}
        {...(gradientProps && !node.imageFill ? gradientProps : {})}
        {...(shadowProps || {})}
        stroke={strokeColor}
        strokeWidth={node.strokeWidth}
        cornerRadius={node.cornerRadius}
      />
      {node.imageFill && (
        <ImageFillLayer
          imageFill={node.imageFill}
          width={effectiveWidth}
          height={effectiveHeight}
          cornerRadius={node.cornerRadius}
          clipType="rect"
        />
      )}
      {layoutChildren.map((child) => (
        <RenderNode
          key={child.id}
          node={child}
          effectiveTheme={childTheme}
          selectOverrideId={childSelectOverride}
        />
      ))}
      {/* Hover outline */}
      {isHovered && (
        <SelectionOutline
          x={0}
          y={0}
          width={effectiveWidth}
          height={effectiveHeight}
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
          cornerRadius={node.cornerRadius}
        />
      )}
    </Group>
  );
}
