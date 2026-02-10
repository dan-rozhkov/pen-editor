import { memo } from "react";
import Konva from "konva";
import { Line } from "react-konva";
import type { LineNode } from "@/types/scene";
import {
  SelectionOutline,
  getHoverOutlineColor,
  getRectTransformProps,
} from "./renderUtils";

interface LineRendererProps {
  node: LineNode;
  strokeColor?: string;
  shadowProps?: Record<string, unknown>;
  isHovered: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
}

export const LineRenderer = memo(function LineRenderer({
  node,
  strokeColor,
  shadowProps,
  isHovered,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
}: LineRendererProps) {
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
        stroke={strokeColor || node.stroke || "#333333"}
        strokeWidth={node.strokeWidth ?? 2}
        {...(shadowProps || {})}
        opacity={node.opacity ?? 1}
        rotation={rectTransform.rotation}
        offsetX={rectTransform.offsetX}
        offsetY={rectTransform.offsetY}
        scaleX={rectTransform.scaleX}
        scaleY={rectTransform.scaleY}
        hitStrokeWidth={10}
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
