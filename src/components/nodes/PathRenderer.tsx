import Konva from "konva";
import { Group, Path, Rect } from "react-konva";
import type { PathNode } from "@/types/scene";
import {
  HOVER_OUTLINE_COLOR,
  SelectionOutline,
} from "./renderUtils";

interface PathRendererProps {
  node: PathNode;
  fillColor?: string;
  strokeColor?: string;
  gradientProps?: Record<string, unknown>;
  isHovered: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function PathRenderer({
  node,
  fillColor,
  strokeColor,
  gradientProps,
  isHovered,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
}: PathRendererProps) {
  // Resolve stroke from pathStroke or fallback to base strokeColor
  const pathStrokeColor = node.pathStroke?.fill || strokeColor;
  const pathStrokeWidth = node.pathStroke?.thickness ?? node.strokeWidth;
  const lineJoin = (node.pathStroke?.join as CanvasLineJoin) ?? "round";
  const lineCap = (node.pathStroke?.cap as CanvasLineCap) ?? "round";

  const rotation = node.rotation ?? 0;
  const flipX = node.flipX ?? false;
  const flipY = node.flipY ?? false;

  const geometryBounds = node.geometryBounds;
  const geometryWidth = Math.max(1, geometryBounds?.width ?? node.width);
  const geometryHeight = Math.max(1, geometryBounds?.height ?? node.height);
  const scaleX = geometryBounds ? node.width / geometryWidth : 1;
  const scaleY = geometryBounds ? node.height / geometryHeight : 1;

  // Offset the path rendering to normalize geometry coordinates to (0,0)
  const geoOffsetX = -(geometryBounds?.x ?? 0) * scaleX;
  const geoOffsetY = -(geometryBounds?.y ?? 0) * scaleY;

  return (
    <>
      <Group
        id={node.id}
        name="selectable"
        x={node.x}
        y={node.y}
        width={node.width}
        height={node.height}
        rotation={rotation}
        offsetX={flipX ? node.width : 0}
        offsetY={flipY ? node.height : 0}
        scaleX={flipX ? -1 : 1}
        scaleY={flipY ? -1 : 1}
        opacity={node.opacity ?? 1}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onTransformEnd={onTransformEnd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {/* Invisible rect for reliable hit detection */}
        <Rect
          width={node.width}
          height={node.height}
          fill="transparent"
          listening={true}
        />
        <Path
          x={geoOffsetX}
          y={geoOffsetY}
          scaleX={scaleX}
          scaleY={scaleY}
          data={node.geometry}
          fill={gradientProps ? undefined : fillColor}
          {...(gradientProps ?? {})}
          stroke={pathStrokeColor}
          strokeWidth={pathStrokeWidth}
          lineJoin={lineJoin}
          lineCap={lineCap}
          listening={false}
        />
      </Group>
      {/* Hover outline */}
      {isHovered && (
        <SelectionOutline
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          rotation={rotation}
          flipX={flipX}
          flipY={flipY}
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={1.5}
        />
      )}
    </>
  );
}
