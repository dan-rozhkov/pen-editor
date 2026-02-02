import Konva from "konva";
import { Line } from "react-konva";
import type { LineNode } from "@/types/scene";
import {
  HOVER_OUTLINE_COLOR,
  SelectionOutline,
  getRectTransformProps,
} from "./renderUtils";

interface LineRendererProps {
  node: LineNode;
  strokeColor?: string;
  isHovered: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function LineRenderer({
  node,
  strokeColor,
  isHovered,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
}: LineRendererProps) {
  const rectTransform = getRectTransformProps(node);

  return (
    <>
      <Line
        id={node.id}
        name="selectable"
        x={rectTransform.x}
        y={rectTransform.y}
        points={node.points}
        stroke={strokeColor || node.stroke || "#333333"}
        strokeWidth={node.strokeWidth ?? 2}
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
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
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
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
        />
      )}
    </>
  );
}
