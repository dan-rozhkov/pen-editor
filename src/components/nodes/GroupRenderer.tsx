import Konva from "konva";
import { Group, Rect } from "react-konva";
import type { GroupNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  findChildAtPosition,
  getNodeAbsolutePosition,
} from "@/utils/nodeUtils";
import {
  HOVER_OUTLINE_COLOR,
  SelectionOutline,
  getChildSelectOverride,
  getRectTransformProps,
} from "./renderUtils";
import { RenderNode } from "./RenderNode";

/**
 * Parse SVG path data and trace it on a canvas 2D context.
 * Supports M, L, C, Q, Z commands (the most common ones).
 */
function traceSvgPathOnContext(ctx: CanvasRenderingContext2D, pathData: string) {
  ctx.beginPath();

  const commands = pathData.match(/[MLCQZmlcqz][^MLCQZmlcqz]*/g) || [];
  let currentX = 0;
  let currentY = 0;

  for (const cmd of commands) {
    const type = cmd[0];
    const args = cmd.slice(1).trim().split(/[\s,]+/).map(parseFloat).filter(n => !isNaN(n));

    switch (type) {
      case 'M':
        currentX = args[0];
        currentY = args[1];
        ctx.moveTo(currentX, currentY);
        break;
      case 'm':
        currentX += args[0];
        currentY += args[1];
        ctx.moveTo(currentX, currentY);
        break;
      case 'L':
        currentX = args[0];
        currentY = args[1];
        ctx.lineTo(currentX, currentY);
        break;
      case 'l':
        currentX += args[0];
        currentY += args[1];
        ctx.lineTo(currentX, currentY);
        break;
      case 'C':
        for (let i = 0; i < args.length; i += 6) {
          ctx.bezierCurveTo(args[i], args[i+1], args[i+2], args[i+3], args[i+4], args[i+5]);
          currentX = args[i+4];
          currentY = args[i+5];
        }
        break;
      case 'c':
        for (let i = 0; i < args.length; i += 6) {
          ctx.bezierCurveTo(
            currentX + args[i], currentY + args[i+1],
            currentX + args[i+2], currentY + args[i+3],
            currentX + args[i+4], currentY + args[i+5]
          );
          currentX += args[i+4];
          currentY += args[i+5];
        }
        break;
      case 'Q':
        for (let i = 0; i < args.length; i += 4) {
          ctx.quadraticCurveTo(args[i], args[i+1], args[i+2], args[i+3]);
          currentX = args[i+2];
          currentY = args[i+3];
        }
        break;
      case 'q':
        for (let i = 0; i < args.length; i += 4) {
          ctx.quadraticCurveTo(
            currentX + args[i], currentY + args[i+1],
            currentX + args[i+2], currentY + args[i+3]
          );
          currentX += args[i+2];
          currentY += args[i+3];
        }
        break;
      case 'Z':
      case 'z':
        ctx.closePath();
        break;
    }
  }
}

interface GroupRendererProps {
  node: GroupNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  effectiveTheme: ThemeName;
  isHovered: boolean;
  isTopLevel: boolean;
  selectOverrideId?: string;
}

export function GroupRenderer({
  node,
  onClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  onTransformEnd,
  onMouseEnter,
  onMouseLeave,
  effectiveTheme,
  isHovered,
  isTopLevel,
  selectOverrideId,
}: GroupRendererProps) {
  const nodes = useSceneStore((state) => state.nodes);
  const { select, enterContainer } = useSelectionStore();
  const enteredContainerId = useSelectionStore(
    (state) => state.enteredContainerId,
  );

  const childSelectOverride = getChildSelectOverride({
    nodes,
    nodeId: node.id,
    isTopLevel,
    selectOverrideId,
    enteredContainerId,
  });

  const groupTransform = getRectTransformProps(node);

  // Double-click to enter this group (drill down)
  const handleGroupDblClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    e.cancelBubble = true;
    if (selectOverrideId) return;
    enterContainer(node.id);
    // Find the child under the cursor and select it
    const stage = e.target.getStage();
    if (!stage) return;
    const pointerPos = stage.getRelativePointerPosition();
    if (!pointerPos) return;
    // Use absolute position to correctly handle nested groups
    const absPos = getNodeAbsolutePosition(nodes, node.id);
    if (!absPos) return;
    const localX = pointerPos.x - absPos.x;
    const localY = pointerPos.y - absPos.y;
    const childId = findChildAtPosition(node.children, localX, localY);
    if (childId) {
      select(childId);
      return;
    }
  };

  // Calculate clip path scaling if clip geometry is present
  const clipBounds = node.clipBounds;
  const clipScaleX = clipBounds ? node.width / Math.max(1, clipBounds.width) : 1;
  const clipScaleY = clipBounds ? node.height / Math.max(1, clipBounds.height) : 1;
  const clipOffsetX = -(clipBounds?.x ?? 0) * clipScaleX;
  const clipOffsetY = -(clipBounds?.y ?? 0) * clipScaleY;

  return (
    <Group
      id={node.id}
      name="selectable"
      {...groupTransform}
      opacity={node.opacity ?? 1}
      draggable
      onClick={onClick}
      onTap={onClick}
      onDblClick={handleGroupDblClick}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onTransformEnd={onTransformEnd}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      clipFunc={
        node.clipGeometry
          ? (ctx) => {
              const ctx2d = ctx._context;
              ctx2d.translate(clipOffsetX, clipOffsetY);
              ctx2d.scale(clipScaleX, clipScaleY);
              // Trace the clip path so Konva's clip() will use it
              traceSvgPathOnContext(ctx2d, node.clipGeometry!);
            }
          : undefined
      }
    >
      {/* Invisible hitbox so clicks on empty space within the group register */}
      <Rect width={node.width} height={node.height} fill="transparent" />
      {node.children.map((child) => (
        <RenderNode
          key={child.id}
          node={child}
          effectiveTheme={effectiveTheme}
          selectOverrideId={childSelectOverride}
        />
      ))}
      {/* Hover outline - dashed for groups */}
      {isHovered && (
        <SelectionOutline
          x={0}
          y={0}
          width={node.width}
          height={node.height}
          stroke={HOVER_OUTLINE_COLOR}
          strokeWidth={0.5}
          dash={[4, 4]}
        />
      )}
    </Group>
  );
}
