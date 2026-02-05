import Konva from "konva";
import { Rect } from "react-konva";
import type { SceneNode } from "@/types/scene";
import {
  HOVER_OUTLINE_COLOR,
  ImageFillLayer,
  SelectionOutline,
  getRectTransformProps,
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

export function RectRenderer({
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
        stroke={strokeColor}
        strokeWidth={node.strokeWidth}
        cornerRadius={node.cornerRadius}
        opacity={node.opacity ?? 1}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
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
      {/* Hover outline */}
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
          cornerRadius={node.cornerRadius}
        />
      )}
    </>
  );
}
