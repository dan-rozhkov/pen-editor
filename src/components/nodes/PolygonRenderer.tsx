import { memo } from "react";
import Konva from "konva";
import { Line } from "react-konva";
import type { PolygonNode } from "@/types/scene";
import {
  SelectionOutline,
  getHoverOutlineColor,
  getRectTransformProps,
} from "./renderUtils";

interface PolygonRendererProps {
  node: PolygonNode;
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

export const PolygonRenderer = memo(function PolygonRenderer({
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
}: PolygonRendererProps) {
  const rectTransform = getRectTransformProps(node);

  return (
    <>
      <Line
        id={node.id}
        name="selectable"
        perfectDrawEnabled={false}
        x={rectTransform.x}
        y={rectTransform.y}
        points={node.points}
        closed
        fill={gradientProps ? undefined : fillColor}
        {...(gradientProps ? gradientProps : {})}
        {...(shadowProps || {})}
        stroke={strokeColor}
        strokeWidth={node.strokeWidth}
        opacity={node.opacity ?? 1}
        rotation={rectTransform.rotation}
        offsetX={rectTransform.offsetX}
        offsetY={rectTransform.offsetY}
        scaleX={rectTransform.scaleX}
        scaleY={rectTransform.scaleY}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
      />
      {isHovered && (
        <SelectionOutline
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rotation={node.rotation ?? 0}
          flipX={node.flipX}
          flipY={node.flipY}
          stroke={getHoverOutlineColor(node.id)}
          strokeWidth={1.5}
        />
      )}
    </>
  );
});
