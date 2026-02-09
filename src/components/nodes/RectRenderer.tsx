import { memo, useState, useCallback, useEffect } from "react";
import Konva from "konva";
import { Rect } from "react-konva";
import type { SceneNode } from "@/types/scene";
import {
  HOVER_OUTLINE_COLOR,
  ImageFillLayer,
  PerSideStrokeLines,
  SelectionOutline,
  getRectTransformProps,
  hasPerSideStroke,
} from "./renderUtils";

interface RectRendererProps {
  node: SceneNode & { type: "rect" };
  fillColor?: string;
  strokeColor?: string;
  gradientProps?: Record<string, unknown>;
  shadowProps?: Record<string, unknown>;
  isHovered: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
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

  const handleDragStartInternal = useCallback(() => {
    setDragPosition({ x: node.x, y: node.y });
    onDragStart();
  }, [node.x, node.y, onDragStart]);

  const handleDragMoveInternal = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    onDragMove(e);
    setDragPosition({ x: e.target.x(), y: e.target.y() });
  }, [onDragMove]);

  const handleDragEndInternal = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    setDragPosition({ x: e.target.x(), y: e.target.y() });
    onDragEnd(e);
  }, [onDragEnd]);

  return (
    <>
      <Rect
        id={node.id}
        name="selectable"
        perfectDrawEnabled={false}
        {...rectTransform}
        fill={node.imageFill || gradientProps ? undefined : fillColor}
        {...(gradientProps && !node.imageFill ? gradientProps : {})}
        {...(shadowProps || {})}
        stroke={usePerSideStroke ? undefined : strokeColor}
        strokeWidth={usePerSideStroke ? undefined : node.strokeWidth}
        cornerRadius={node.cornerRadius}
        opacity={node.opacity ?? 1}
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
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
          cornerRadius={node.cornerRadius}
        />
      )}
    </>
  );
});
