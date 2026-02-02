import Konva from "konva";
import { Text } from "react-konva";
import type { TextNode } from "@/types/scene";
import {
  HOVER_OUTLINE_COLOR,
  SelectionOutline,
  buildKonvaFontStyle,
  buildTextDecoration,
  getRectTransformProps,
  getTextDimensions,
} from "./renderUtils";

interface TextRendererProps {
  node: TextNode;
  fillColor?: string;
  gradientProps?: Record<string, unknown>;
  shadowProps?: Record<string, unknown>;
  isHovered: boolean;
  isEditing: boolean;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformStart: (e: Konva.KonvaEventObject<Event>) => void;
  onTransform: (e: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function TextRenderer({
  node,
  fillColor,
  gradientProps,
  shadowProps,
  isHovered,
  isEditing,
  onClick,
  onDblClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformStart,
  onTransform,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
}: TextRendererProps) {
  // For auto width mode, don't set width to let Konva calculate it from text
  const { width: textWidth, height: textHeight } = getTextDimensions(node);
  const textTransform = getRectTransformProps(node);
  const textDecoration = buildTextDecoration(node);

  return (
    <>
      <Text
        id={node.id}
        name="selectable"
        {...textTransform}
        width={textWidth}
        height={textHeight ?? node.height}
        text={node.text}
        fontSize={node.fontSize ?? 16}
        fontFamily={node.fontFamily ?? "Arial"}
        fontStyle={buildKonvaFontStyle(node)}
        textDecoration={textDecoration}
        fill={gradientProps ? undefined : (fillColor ?? "#000000")}
        {...(gradientProps ?? {})}
        {...(shadowProps || {})}
        align={node.textAlign ?? "left"}
        verticalAlign={node.textAlignVertical ?? "top"}
        lineHeight={node.lineHeight ?? 1.2}
        letterSpacing={node.letterSpacing ?? 0}
        opacity={(isEditing ? 0 : 1) * (node.opacity ?? 1)}
        draggable={!isEditing}
        onClick={onClick}
        onTap={onClick}
        onDblClick={onDblClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onTransformStart={onTransformStart}
        onTransform={onTransform}
        onTransformEnd={onTransformEnd}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      />
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
        />
      )}
    </>
  );
}
