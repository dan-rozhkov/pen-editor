import { useRef } from "react";
import Konva from "konva";
import { Group, Rect } from "react-konva";
import type { GroupNode } from "@/types/scene";
import type { ThemeName } from "@/types/variable";
import { useDragStore } from "@/store/dragStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import {
  findChildAtPosition,
  getNodeAbsolutePosition,
} from "@/utils/nodeUtils";
import {
  SelectionOutline,
  getHoverOutlineColor,
  getChildSelectOverride,
  getRectTransformProps,
} from "./renderUtils";
import { RenderNode } from "./RenderNode";
import { useKonvaGroupCaching } from "@/hooks/useKonvaGroupCaching";

interface GroupRendererProps {
  node: GroupNode;
  onClick: (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onTransformEnd: (e: Konva.KonvaEventObject<Event>) => void;
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
  effectiveTheme,
  isHovered,
  isTopLevel,
  selectOverrideId,
}: GroupRendererProps) {
  const parentById = useSceneStore((state) => state.parentById);
  const { select, enterContainer } = useSelectionStore();
  const enteredContainerId = useSelectionStore(
    (state) => state.enteredContainerId,
  );
  const isDragging = useDragStore((state) => state.isDragging);

  const groupRef = useRef<Konva.Group | null>(null);
  const shouldCache = !isDragging && node.children.length >= 30;

  useKonvaGroupCaching(groupRef, shouldCache, [node]);

  const childSelectOverride = getChildSelectOverride({
    parentById,
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
    const absPos = getNodeAbsolutePosition(useSceneStore.getState().getNodes(), node.id);
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

  return (
    <Group
      ref={groupRef}
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
      clipFunc={
        node.clipGeometry && node.clipBounds
          ? (ctx) => {
              // For groups, clip in the group's local coordinate space
              // Scale the clip to match any group resizing
              const cb = node.clipBounds!;
              ctx.rect(
                cb.x * clipScaleX,
                cb.y * clipScaleY,
                cb.width * clipScaleX,
                cb.height * clipScaleY
              );
            }
          : undefined
      }
    >
      {/* Invisible hitbox so clicks on empty space within the group register */}
      <Rect
        width={node.width}
        height={node.height}
        fill="transparent"
        perfectDrawEnabled={false}
      />
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
          stroke={getHoverOutlineColor(node.id)}
          strokeWidth={0.5}
          dash={[4, 4]}
        />
      )}
    </Group>
  );
}
