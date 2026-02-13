import { memo } from "react";
import Konva from "konva";
import { Ellipse } from "react-konva";
import type { FrameNode, SceneNode } from "@/types/scene";
import { useDragStore } from "@/store/dragStore";
import { useSceneStore } from "@/store/sceneStore";
import { handleAutoLayoutDragEnd } from "@/utils/dragUtils";
import {
  ImageFillLayer,
  SelectionOutline,
  getHoverOutlineColor,
  getEllipseTransformProps,
  makeEllipseSceneFunc,
} from "./renderUtils";

interface EllipseRendererProps {
  node: SceneNode & { type: "ellipse" };
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  fillColor?: string;
  strokeColor?: string;
  gradientProps?: Record<string, unknown>;
  shadowProps?: Record<string, unknown>;
  isInAutoLayout: boolean;
  parentFrame: FrameNode | null;
  isHovered: boolean;
}

export const EllipseRenderer = memo(function EllipseRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  fillColor,
  strokeColor,
  gradientProps,
  shadowProps,
  isInAutoLayout,
  parentFrame,
  isHovered,
}: EllipseRendererProps) {
  const updateNode = useSceneStore((state) => state.updateNode);
  const moveNode = useSceneStore((state) => state.moveNode);
  const { endDrag } = useDragStore();
  const ellipseTransform = getEllipseTransformProps(node);

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const target = e.target;

    // Only process if this is the actual node being dragged
    // Prevents parent Group from handling child drag events
    if (target.id() !== node.id) return;

    if (isInAutoLayout && parentFrame) {
      const { insertInfo, isOutsideParent } = useDragStore.getState();

      handleAutoLayoutDragEnd(
        target,
        node.id,
        node.width,
        node.height,
        insertInfo,
        isOutsideParent,
        moveNode,
        updateNode,
        // Ellipse uses center, so adjust position
        () => ({ x: node.x + node.width / 2, y: node.y + node.height / 2 }),
      );

      endDrag();
    } else {
      // Ellipse position is center, convert back to top-left
      updateNode(node.id, {
        x: target.x() - node.width / 2,
        y: target.y() - node.height / 2,
      });
    }
  };

  const handleTransformEnd = (e: Konva.KonvaEventObject<Event>) => {
    const target = e.target as Konva.Ellipse;
    const scaleX = target.scaleX();
    const scaleY = target.scaleY();
    const rotation = target.rotation();

    const newWidth = Math.max(5, target.radiusX() * 2 * Math.abs(scaleX));
    const newHeight = Math.max(5, target.radiusY() * 2 * Math.abs(scaleY));

    // Reset scale, preserving flip
    const flipSignX = node.flipX ? -1 : 1;
    const flipSignY = node.flipY ? -1 : 1;
    target.scaleX(flipSignX);
    target.scaleY(flipSignY);

    // Update radiuses
    target.radiusX(newWidth / 2);
    target.radiusY(newHeight / 2);

    updateNode(node.id, {
      x: target.x() - newWidth / 2,
      y: target.y() - newHeight / 2,
      width: newWidth,
      height: newHeight,
      rotation: rotation,
    });
  };

  const align = node.strokeAlign ?? 'center';
  const useAlignedStroke = align !== 'center';
  const alignedSceneFunc = useAlignedStroke
    ? makeEllipseSceneFunc(
        node.width, node.height,
        (node.imageFill || gradientProps) ? undefined : fillColor,
        strokeColor, node.strokeWidth, align,
      )
    : undefined;

  return (
    <>
      <Ellipse
        id={node.id}
        name="selectable"
        perfectDrawEnabled={false}
        {...ellipseTransform}
        fill={useAlignedStroke ? undefined : (node.imageFill || gradientProps ? undefined : fillColor)}
        {...(!useAlignedStroke && gradientProps && !node.imageFill ? gradientProps : {})}
        {...(shadowProps || {})}
        stroke={useAlignedStroke ? undefined : strokeColor}
        strokeWidth={useAlignedStroke ? undefined : node.strokeWidth}
        opacity={node.opacity ?? 1}
        sceneFunc={alignedSceneFunc}
        draggable
        onClick={onClick}
        onTap={onClick}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={handleDragEnd}
        onTransformEnd={handleTransformEnd}
      />
      {node.imageFill && (
        <ImageFillLayer
          imageFill={node.imageFill}
          x={node.x}
          y={node.y}
          width={node.width}
          height={node.height}
          clipType="ellipse"
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
          shape="ellipse"
          stroke={getHoverOutlineColor(node.id)}
          strokeWidth={1.5}
        />
      )}
    </>
  );
});
