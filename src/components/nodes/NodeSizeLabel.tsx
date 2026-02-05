import { Group, Rect, Text } from "react-konva";
import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import type { SceneNode, FrameNode } from "../../types/scene";
import { useViewportStore } from "../../store/viewportStore";

interface NodeSizeLabelProps {
  node?: SceneNode;
  nodeIds?: string[];
  absoluteX: number;
  absoluteY: number;
  effectiveWidth: number;
  effectiveHeight: number;
}

const LABEL_FONT_SIZE = 11;
const LABEL_OFFSET_Y = 6;
const LABEL_PADDING_X = 6;
const LABEL_PADDING_Y = 3;
const LABEL_CORNER_RADIUS = 3;
const LABEL_BG_COLOR_DEFAULT = "#0d99ff"; // Blue background
const LABEL_BG_COLOR_COMPONENT = "#9747ff"; // Purple background for components/instances
const LABEL_TEXT_COLOR = "#ffffff"; // White text

export function NodeSizeLabel({
  node,
  nodeIds,
  absoluteX,
  absoluteY,
  effectiveWidth,
  effectiveHeight,
}: NodeSizeLabelProps) {
  const { scale } = useViewportStore();
  const textRef = useRef<Konva.Text>(null);
  const groupRef = useRef<Konva.Group>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [dragState, setDragState] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  // Determine which node IDs to track for drag/transform
  const trackIds = nodeIds ?? (node ? [node.id] : []);

  // Update text width for centering
  useEffect(() => {
    if (textRef.current) {
      setTextWidth(textRef.current.width());
    }
  });

  // Track node(s) real-time position and size during drag/transform
  useEffect(() => {
    if (trackIds.length === 0) return;

    const stage = groupRef.current?.getStage();
    if (!stage) return;

    const konvaNodes: Konva.Node[] = [];
    for (const id of trackIds) {
      const konvaNode = stage.findOne(`#${id}`);
      if (konvaNode) {
        konvaNodes.push(konvaNode);
      }
    }

    if (konvaNodes.length === 0) return;

    const updateDragState = () => {
      // Just set a non-null state to trigger hiding the label
      setDragState({ x: 0, y: 0, width: 0, height: 0 });
    };

    const handleEnd = () => {
      setDragState(null);
    };

    for (const konvaNode of konvaNodes) {
      konvaNode.on("dragmove", updateDragState);
      konvaNode.on("transform", updateDragState);
      konvaNode.on("dragend", handleEnd);
      konvaNode.on("transformend", handleEnd);
    }

    return () => {
      for (const konvaNode of konvaNodes) {
        konvaNode.off("dragmove", updateDragState);
        konvaNode.off("transform", updateDragState);
        konvaNode.off("dragend", handleEnd);
        konvaNode.off("transformend", handleEnd);
      }
    };
  }, [trackIds.join(",")]);

  // Hide label during drag/transform
  if (dragState !== null) {
    return null;
  }

  const safeScale = scale || 1;
  const worldOffsetY = LABEL_OFFSET_Y / safeScale;

  // Position at bottom center of the node
  const labelX = absoluteX + effectiveWidth / 2;
  const labelY = absoluteY + effectiveHeight + worldOffsetY;

  // Format dimensions
  const displayText = `${Math.round(effectiveWidth)} × ${Math.round(effectiveHeight)}`;

  // Determine label color based on node type
  // Use purple for components (reusable frames) and instances (ref nodes)
  const isComponentOrInstance =
    (node?.type === "frame" && (node as FrameNode).reusable) ||
    node?.type === "ref";
  const labelBgColor = isComponentOrInstance
    ? LABEL_BG_COLOR_COMPONENT
    : LABEL_BG_COLOR_DEFAULT;

  // Calculate background dimensions
  const bgWidth = textWidth + LABEL_PADDING_X * 2;
  const bgHeight = LABEL_FONT_SIZE + LABEL_PADDING_Y * 2;

  return (
    <Group
      ref={groupRef}
      x={labelX}
      y={labelY}
      scaleX={1 / safeScale}
      scaleY={1 / safeScale}
      offsetX={bgWidth / 2}
      listening={false}
    >
      {/* Background */}
      <Rect
        width={bgWidth}
        height={bgHeight}
        fill={labelBgColor}
        cornerRadius={LABEL_CORNER_RADIUS}
        perfectDrawEnabled={false}
      />
      {/* Text */}
      <Text
        ref={textRef}
        x={LABEL_PADDING_X}
        y={LABEL_PADDING_Y}
        text={displayText}
        fontSize={LABEL_FONT_SIZE}
        fontFamily="system-ui, -apple-system, sans-serif"
        fill={LABEL_TEXT_COLOR}
        perfectDrawEnabled={false}
      />
    </Group>
  );
}
