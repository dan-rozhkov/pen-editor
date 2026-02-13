import { useRef, useEffect, useCallback, useMemo } from "react";
import Konva from "konva";
import { Group, Rect } from "react-konva";
import type { FrameNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { useLayoutStore } from "@/store/layoutStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDragStore } from "@/store/dragStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import {
  findDeepestChildAtPosition,
  getNodeAbsolutePositionWithLayout,
} from "@/utils/nodeUtils";
import {
  getViewportBounds,
  isChildVisibleInViewport,
} from "@/utils/viewportUtils";
import {
  ImageFillLayer,
  PerSideStrokeLines,
  SelectionOutline,
  getHoverOutlineColor,
  getChildSelectOverride,
  getRectTransformProps,
  hasPerSideStroke,
  makeRectSceneFunc,
} from "./renderUtils";
import { prepareFrameNode } from "./instanceUtils";
import { RenderNode } from "./RenderNode";

interface FrameRendererProps {
  node: FrameNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: (e: Konva.KonvaEventObject<Event>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
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
  fillColor,
  strokeColor,
  gradientProps,
  shadowProps,
  effectiveTheme,
  isHovered,
  isTopLevel,
  selectOverrideId,
}: FrameRendererProps) {
  const parentById = useSceneStore((state) => state.parentById);
  const { select, enterContainer } = useSelectionStore();
  const enteredContainerId = useSelectionStore(
    (state) => state.enteredContainerId,
  );
  const isDragging = useDragStore((state) => state.isDragging);
  const stageRef = useCanvasRefStore((state) => state.stageRef);
  const calculateLayoutForFrame = useLayoutStore(
    (state) => state.calculateLayoutForFrame,
  );

  const { scale: vpScale, x: vpX, y: vpY } = useViewportStore();

  // Calculate layout children and effective frame size using shared prepared pipeline
  const preparedFrame = useMemo(
    () => prepareFrameNode(node, calculateLayoutForFrame),
    [node, calculateLayoutForFrame],
  );
  const { layoutChildren, effectiveWidth, effectiveHeight } = preparedFrame;

  // Viewport-cull children for frames with many children (>10)
  // Only when the frame is NOT clipping (clipped frames are already bounded visually)
  const visibleChildren = useMemo(() => {
    if (layoutChildren.length <= 10) return layoutChildren;
    // Get the frame's absolute position to compute child absolute positions
    const absPos = getNodeAbsolutePositionWithLayout(
      useSceneStore.getState().getNodes(),
      node.id,
      calculateLayoutForFrame,
    );
    if (!absPos) return layoutChildren;
    // Get a stage-sized viewport estimate (use a generous default)
    const stageW = stageRef?.width() ?? 1920;
    const stageH = stageRef?.height() ?? 1080;
    const bounds = getViewportBounds(vpScale, vpX, vpY, stageW, stageH);
    return layoutChildren.filter((child) =>
      isChildVisibleInViewport(child, absPos.x, absPos.y, bounds),
    );
  }, [layoutChildren, node.id, vpScale, vpX, vpY, stageRef]);

  // If this frame has a theme override, use it for children
  const childTheme = node.themeOverride ?? effectiveTheme;

  const childSelectOverride = getChildSelectOverride({
    parentById,
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

  const shouldCache =
    !isDragging &&
    layoutChildren.length >= 30 &&
    !node.clip;

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    if (!shouldCache) {
      group.clearCache();
      return;
    }
    group.cache({ pixelRatio: 1 });
  }, [shouldCache, node, layoutChildren]);

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
    const absPos = getNodeAbsolutePositionWithLayout(
      useSceneStore.getState().getNodes(),
      node.id,
      calculateLayoutForFrame,
    );
    if (!absPos) return;
    const localX = pointerPos.x - absPos.x;
    const localY = pointerPos.y - absPos.y;
    // Use layout-calculated children for accurate hit detection
    const hitChildren = layoutChildren;
    const childId = findDeepestChildAtPosition(hitChildren, localX, localY);
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
      {(() => {
        const usePerSide = hasPerSideStroke(node.strokeWidthPerSide);
        const align = node.strokeAlign ?? 'center';
        const useAligned = align !== 'center' && !usePerSide;
        const sf = useAligned
          ? makeRectSceneFunc(
              effectiveWidth, effectiveHeight, node.cornerRadius,
              (node.imageFill || gradientProps) ? undefined : fillColor,
              strokeColor, node.strokeWidth, align,
            )
          : undefined;
        return (
          <Rect
            width={effectiveWidth}
            height={effectiveHeight}
            perfectDrawEnabled={false}
            fill={useAligned ? undefined : (node.imageFill || gradientProps ? undefined : fillColor)}
            {...(!useAligned && gradientProps && !node.imageFill ? gradientProps : {})}
            {...(shadowProps || {})}
            stroke={usePerSide || useAligned ? undefined : strokeColor}
            strokeWidth={usePerSide || useAligned ? undefined : node.strokeWidth}
            cornerRadius={useAligned ? undefined : node.cornerRadius}
            sceneFunc={sf}
          />
        );
      })()}
      {/* Per-side stroke for frames */}
      {hasPerSideStroke(node.strokeWidthPerSide) && strokeColor && node.strokeWidthPerSide && (
        <PerSideStrokeLines
          x={0}
          y={0}
          width={effectiveWidth}
          height={effectiveHeight}
          strokeColor={strokeColor}
          strokeWidthPerSide={node.strokeWidthPerSide}
          strokeAlign={node.strokeAlign}
        />
      )}
      {node.imageFill && (
        <ImageFillLayer
          imageFill={node.imageFill}
          width={effectiveWidth}
          height={effectiveHeight}
          cornerRadius={node.cornerRadius}
          clipType="rect"
        />
      )}
      {visibleChildren.map((child) => (
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
          stroke={getHoverOutlineColor(node.id)}
          strokeWidth={1.5}
          cornerRadius={node.cornerRadius}
        />
      )}
    </Group>
  );
}
