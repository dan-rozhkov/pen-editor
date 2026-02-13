import { memo, useState, useCallback, useEffect } from "react";
import Konva from "konva";
import { Rect } from "react-konva";
import type { SceneNode } from "@/types/scene";
import {
  ImageFillLayer,
  PerSideStrokeLines,
  SelectionOutline,
  getHoverOutlineColor,
  getRectTransformProps,
  hasPerSideStroke,
  makeRectSceneFunc,
} from "./renderUtils";

interface RectRendererProps {
  node: SceneNode & { type: "rect" };
  fillColor?: string;
  strokeColor?: string;
  gradientProps?: Record<string, unknown>;
  shadowProps?: Record<string, unknown>;
  isHovered: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}

export const RectRenderer = memo(function RectRenderer({
  node,
  fillColor,
  strokeColor,
  gradientProps,
  shadowProps,
  isHovered,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}: RectRendererProps) {
  const rectTransform = getRectTransformProps(node);
  const usePerSideStroke = hasPerSideStroke(node.strokeWidthPerSide);
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);

  const renderX = dragPosition?.x ?? node.x;
  const renderY = dragPosition?.y ?? node.y;

  useEffect(() => {
    if (!dragPosition) return;
    if (dragPosition.x === node.x && dragPosition.y === node.y) {
      setDragPosition(null);
    }
  }, [dragPosition, node.x, node.y]);

  const handleDragStartInternal = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    setDragPosition({ x: node.x, y: node.y });
    onDragStart(e);
  }, [node.x, node.y, onDragStart]);

  const handleDragMoveInternal = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onDragMove(e);
    setDragPosition({ x: e.target.x(), y: e.target.y() });
  }, [onDragMove]);

  const handleDragEndInternal = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    setDragPosition({ x: e.target.x(), y: e.target.y() });
    onDragEnd(e);
  }, [onDragEnd]);

  const align = node.strokeAlign ?? 'center';
  const useAlignedStroke = align !== 'center' && !usePerSideStroke;
  const alignedSceneFunc = useAlignedStroke
    ? makeRectSceneFunc(
        node.width, node.height, node.cornerRadius,
        (node.imageFill || gradientProps) ? undefined : fillColor,
        strokeColor, node.strokeWidth, align,
      )
    : undefined;

  return (
    <>
      <Rect
        id={node.id}
        name="selectable"
        perfectDrawEnabled={false}
        {...rectTransform}
        fill={useAlignedStroke ? undefined : (node.imageFill || gradientProps ? undefined : fillColor)}
        {...(!useAlignedStroke && gradientProps && !node.imageFill ? gradientProps : {})}
        {...(shadowProps || {})}
        stroke={usePerSideStroke || useAlignedStroke ? undefined : strokeColor}
        strokeWidth={usePerSideStroke || useAlignedStroke ? undefined : node.strokeWidth}
        cornerRadius={useAlignedStroke ? undefined : node.cornerRadius}
        opacity={node.opacity ?? 1}
        sceneFunc={alignedSceneFunc}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragStart={handleDragStartInternal}
        onDragMove={handleDragMoveInternal}
        onDragEnd={handleDragEndInternal}
        onTransformEnd={onTransformEnd}
      />
      {/* Per-side stroke */}
      {usePerSideStroke && strokeColor && node.strokeWidthPerSide && (
        <PerSideStrokeLines
          x={renderX}
          y={renderY}
          width={node.width}
          height={node.height}
          strokeColor={strokeColor}
          strokeWidthPerSide={node.strokeWidthPerSide}
          strokeAlign={node.strokeAlign}
          rotation={node.rotation}
          flipX={node.flipX}
          flipY={node.flipY}
        />
      )}
      {node.imageFill && (
        <ImageFillLayer
          imageFill={node.imageFill}
          x={renderX}
          y={renderY}
          width={node.width}
          height={node.height}
          cornerRadius={node.cornerRadius}
          clipType="rect"
        />
      )}
      {/* Hover outline */}
      {isHovered && (
        <SelectionOutline
          x={renderX}
          y={renderY}
          width={node.width}
          height={node.height}
          rotation={node.rotation ?? 0}
          flipX={node.flipX}
          flipY={node.flipY}
          stroke={getHoverOutlineColor(node.id)}
          strokeWidth={1.5}
          cornerRadius={node.cornerRadius}
        />
      )}
    </>
  );
});
