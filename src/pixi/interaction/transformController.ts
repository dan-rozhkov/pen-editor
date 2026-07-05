import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { useGuidesStore } from "@/store/guidesStore";
import type { InteractionContext, TransformState } from "./types";
import { hitTestTransformHandle, getResizeCursor } from "./hitTesting";
import { generatePolygonPoints } from "@/utils/polygonUtils";
import type { PolygonNode, LineNode, RefNode, TextNode, InstanceOverrideUpdateProps, SceneNode } from "@/types/scene";
import { findResolvedDescendantByPath } from "@/utils/instanceRuntime";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { resolveTextResize, minTextWidth } from "./textResize";
import { computeConstrainedRect } from "@/utils/constraintsLayout";
import { snapValueToGuides } from "@/utils/smartGuideUtils";

export interface TransformController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isTransforming: () => boolean;
}

export function createTransformController(context: InteractionContext): TransformController {
  const state: TransformState = {
    isTransforming: false,
    nodeId: null,
    corner: null,
    startNodeX: 0,
    startNodeY: 0,
    startNodeW: 0,
    startNodeH: 0,
    absX: 0,
    absY: 0,
    parentOffsetX: 0,
    parentOffsetY: 0,
    startLinePoints: null,
    slotContext: null,
    frameChildrenStart: null,
  };

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (e.button === 0) {
        const handleHit = hitTestTransformHandle(world.x, world.y);
        if (handleHit) {
          // Slot inside instance — resolve local coordinates for override
          if (handleHit.slotContext) {
            const scState = useSceneStore.getState();
            const calcLayout = useLayoutStore.getState().calculateLayoutForFrame;
            const inst = scState.nodesById[handleHit.slotContext.instanceId];
            if (!inst || inst.type !== "ref") return false;
            const effSize = getNodeEffectiveSize(scState.getNodes(), inst.id, calcLayout);
            const refWithLayout: RefNode = effSize
              ? { ...(inst as RefNode), width: effSize.width, height: effSize.height }
              : (inst as RefNode);
            const resolved = findResolvedDescendantByPath(
              refWithLayout,
              handleHit.slotContext.descendantPath,
              scState.nodesById, scState.childrenById, scState.parentById,
              calcLayout,
            );
            if (!resolved) return false;

            state.isTransforming = true;
            state.nodeId = handleHit.nodeId;
            state.corner = handleHit.corner;
            state.slotContext = handleHit.slotContext;
            state.startNodeX = resolved.node.x; // local X
            state.startNodeY = resolved.node.y; // local Y
            state.startNodeW = handleHit.width;
            state.startNodeH = handleHit.height;
            state.absX = handleHit.absX; // absolute X for resize math
            state.absY = handleHit.absY;
            // World-space offset between the slot's local coords and its
            // absolute position, so guide snapping (which compares against
            // world-space guide positions) works the same as the normal branch.
            state.parentOffsetX = handleHit.absX - resolved.node.x;
            state.parentOffsetY = handleHit.absY - resolved.node.y;
            state.startLinePoints = null;
            state.frameChildrenStart = null;
            context.canvas.style.cursor = getResizeCursor(handleHit.corner);
            return true;
          }

          const sceneState = useSceneStore.getState();
          const node = sceneState.nodesById[handleHit.nodeId];
          if (node) {
            state.isTransforming = true;
            state.nodeId = handleHit.nodeId;
            state.corner = handleHit.corner;
            state.slotContext = null;
            state.startNodeX = node.x;
            state.startNodeY = node.y;
            state.startNodeW = handleHit.width;
            state.startNodeH = handleHit.height;
            state.absX = handleHit.absX;
            state.absY = handleHit.absY;
            state.parentOffsetX = handleHit.absX - node.x;
            state.parentOffsetY = handleHit.absY - node.y;
            state.startLinePoints = node.type === "line" ? [...(node as LineNode).points] : null;
            // Constraints apply only to direct children of a frame WITHOUT
            // auto-layout (auto-layout frames size children via Yoga).
            state.frameChildrenStart =
              node.type === "frame" && !node.layout?.autoLayout
                ? (sceneState.childrenById[node.id] ?? [])
                    .map((childId) => sceneState.nodesById[childId])
                    .filter((child): child is NonNullable<typeof child> => !!child)
                    .map((child) => ({
                      id: child.id,
                      x: child.x,
                      y: child.y,
                      width: child.width,
                      height: child.height,
                      constraints: child.constraints,
                    }))
                : null;
            context.canvas.style.cursor = getResizeCursor(handleHit.corner);
            return true;
          }
        }
      }
      return false;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (state.isTransforming && state.nodeId && state.corner) {
        const MIN_SIZE = 5;
        const corner = state.corner;
        const absWorldX = world.x;
        const absWorldY = world.y;

        let newX = state.startNodeX;
        let newY = state.startNodeY;
        let newW = state.startNodeW;
        let newH = state.startNodeH;

        // Compute bounding box edges in absolute coordinates
        const origLeft = state.absX;
        const origTop = state.absY;
        const origRight = origLeft + state.startNodeW;
        const origBottom = origTop + state.startNodeH;

        if (corner === "br") {
          newW = Math.max(MIN_SIZE, absWorldX - origLeft);
          newH = Math.max(MIN_SIZE, absWorldY - origTop);
        } else if (corner === "bl") {
          const newRight = origRight;
          const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
          newW = newRight - newLeft;
          newX = state.startNodeX + (newLeft - origLeft);
          newH = Math.max(MIN_SIZE, absWorldY - origTop);
        } else if (corner === "tr") {
          newW = Math.max(MIN_SIZE, absWorldX - origLeft);
          const newBottom = origBottom;
          const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
          newH = newBottom - newTop;
          newY = state.startNodeY + (newTop - origTop);
        } else if (corner === "tl") {
          const newRight = origRight;
          const newBottom = origBottom;
          const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
          const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
          newW = newRight - newLeft;
          newH = newBottom - newTop;
          newX = state.startNodeX + (newLeft - origLeft);
          newY = state.startNodeY + (newTop - origTop);
        } else if (corner === "r") {
          newW = Math.max(MIN_SIZE, absWorldX - origLeft);
        } else if (corner === "l") {
          const newRight = origRight;
          const newLeft = Math.min(absWorldX, newRight - MIN_SIZE);
          newW = newRight - newLeft;
          newX = state.startNodeX + (newLeft - origLeft);
        } else if (corner === "b") {
          newH = Math.max(MIN_SIZE, absWorldY - origTop);
        } else if (corner === "t") {
          const newBottom = origBottom;
          const newTop = Math.min(absWorldY, newBottom - MIN_SIZE);
          newH = newBottom - newTop;
          newY = state.startNodeY + (newTop - origTop);
        }

        // Snap the moving edge(s) to nearby persistent ruler guides.
        const persistentGuides = useGuidesStore.getState().guides;
        if (persistentGuides.length > 0) {
          const scale = useViewportStore.getState().scale;
          const threshold = 4 / scale;
          const movesRight = corner === "br" || corner === "tr" || corner === "r";
          const movesLeft = corner === "bl" || corner === "tl" || corner === "l";
          const movesBottom = corner === "br" || corner === "bl" || corner === "b";
          const movesTop = corner === "tr" || corner === "tl" || corner === "t";

          if (movesRight) {
            const absRight = state.parentOffsetX + newX + newW;
            const snapped = snapValueToGuides(absRight, "vertical", persistentGuides, threshold);
            newW = Math.max(MIN_SIZE, newW + (snapped - absRight));
          } else if (movesLeft) {
            const absLeft = state.parentOffsetX + newX;
            const snapped = snapValueToGuides(absLeft, "vertical", persistentGuides, threshold);
            const delta = snapped - absLeft;
            if (newW - delta >= MIN_SIZE) {
              newX += delta;
              newW -= delta;
            }
          }

          if (movesBottom) {
            const absBottom = state.parentOffsetY + newY + newH;
            const snapped = snapValueToGuides(absBottom, "horizontal", persistentGuides, threshold);
            newH = Math.max(MIN_SIZE, newH + (snapped - absBottom));
          } else if (movesTop) {
            const absTop = state.parentOffsetY + newY;
            const snapped = snapValueToGuides(absTop, "horizontal", persistentGuides, threshold);
            const delta = snapped - absTop;
            if (newH - delta >= MIN_SIZE) {
              newY += delta;
              newH -= delta;
            }
          }
        }

        const roundedW = Math.round(newW);
        const roundedH = Math.round(newH);

        // Slot inside instance — update via instance override (x/y are local coords)
        if (state.slotContext) {
          const overrideUpdates: InstanceOverrideUpdateProps = {
            x: Math.round(newX),
            y: Math.round(newY),
            width: roundedW,
            height: roundedH,
          };
          useSceneStore.getState().updateInstanceOverrideWithoutHistory(
            state.slotContext.instanceId,
            state.slotContext.descendantPath,
            overrideUpdates,
          );
          return true;
        }

        const node = useSceneStore.getState().nodesById[state.nodeId];

        // Text: switch sizing mode based on which handle is dragged and
        // re-hug height live for side (auto-height) drags (Figma parity).
        if (node?.type === "text") {
          const textNode = node as TextNode;
          const clampedW = Math.max(minTextWidth(textNode), roundedW);
          const resolved = resolveTextResize(textNode, corner, clampedW, roundedH);
          useSceneStore.getState().updateNodeWithoutHistory(state.nodeId, {
            x: Math.round(newX),
            y: Math.round(newY),
            width: resolved.width,
            height: resolved.height,
            textWidthMode: resolved.textWidthMode,
          });
          return true;
        }

        const updates: Record<string, unknown> = {
          x: Math.round(newX),
          y: Math.round(newY),
          width: roundedW,
          height: roundedH,
        };

        // Regenerate points for polygon/line nodes
        if (node?.type === "polygon") {
          const sides = (node as PolygonNode).sides ?? 6;
          updates.points = generatePolygonPoints(sides, roundedW, roundedH);
        } else if (node?.type === "line" && state.startLinePoints) {
          const scaleFactorX = roundedW / state.startNodeW;
          const scaleFactorY = roundedH / state.startNodeH;
          updates.points = state.startLinePoints.map((v, i) =>
            i % 2 === 0 ? v * scaleFactorX : v * scaleFactorY,
          );
        }

        // Resizing a non-auto-layout frame: recompute its children's
        // position/size against their constraints, relative to the
        // pointer-down snapshot (not incrementally, to stay numerically stable).
        if (node?.type === "frame" && state.frameChildrenStart && state.frameChildrenStart.length > 0) {
          const updatesById: Record<string, Partial<SceneNode>> = {
            [state.nodeId]: updates as Partial<SceneNode>,
          };
          for (const child of state.frameChildrenStart) {
            const rect = computeConstrainedRect(
              { x: child.x, y: child.y, width: child.width, height: child.height },
              child.constraints,
              { width: state.startNodeW, height: state.startNodeH },
              { width: roundedW, height: roundedH },
            );
            updatesById[child.id] = {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          }
          useSceneStore.getState().updateNodesWithoutHistory(updatesById);
          return true;
        }

        useSceneStore.getState().updateNodeWithoutHistory(state.nodeId, updates);
        return true;
      }
      return false;
    },

    handlePointerUp(_e: PointerEvent, _world: { x: number; y: number }): boolean {
      if (state.isTransforming && state.nodeId) {
        // Slot inside instance — commit via instance override with history
        if (state.slotContext) {
          // Re-apply current values with history (mirrors the normal transform commit pattern)
          useSceneStore.getState().updateInstanceOverride(
            state.slotContext.instanceId,
            state.slotContext.descendantPath,
            {} as InstanceOverrideUpdateProps,
          );
          state.isTransforming = false;
          state.nodeId = null;
          state.corner = null;
          state.slotContext = null;
          state.frameChildrenStart = null;
          context.canvas.style.cursor = "";
          return true;
        }

        const sceneState = useSceneStore.getState();
        const node = sceneState.nodesById[state.nodeId];
        if (node) {
          // Commit the resize with history
          const commitUpdates: Record<string, unknown> = {
            x: node.x,
            y: node.y,
            width: node.width,
            height: node.height,
          };
          if (node.type === "polygon") {
            commitUpdates.points = (node as PolygonNode).points;
          } else if (node.type === "line") {
            commitUpdates.points = (node as LineNode).points;
          } else if (node.type === "text") {
            // Mode was switched live via WithoutHistory; include it so the
            // history record and syncTextDimensions use the new mode.
            commitUpdates.textWidthMode = (node as TextNode).textWidthMode;
          }

          if (state.frameChildrenStart && state.frameChildrenStart.length > 0) {
            // Children were already repositioned live (WithoutHistory) during
            // the drag; re-commit their current values as a single history
            // entry alongside the frame's own resize.
            const updatesById: Record<string, Partial<SceneNode>> = {
              [state.nodeId]: commitUpdates as Partial<SceneNode>,
            };
            for (const child of state.frameChildrenStart) {
              const childNode = sceneState.nodesById[child.id];
              if (!childNode) continue;
              updatesById[child.id] = {
                x: childNode.x,
                y: childNode.y,
                width: childNode.width,
                height: childNode.height,
              };
            }
            useSceneStore.getState().updateNodesById(updatesById);
          } else {
            useSceneStore.getState().updateNode(state.nodeId, commitUpdates);
          }
        }
        state.isTransforming = false;
        state.nodeId = null;
        state.corner = null;
        state.slotContext = null;
        state.frameChildrenStart = null;
        context.canvas.style.cursor = "";
        return true;
      }
      return false;
    },

    isTransforming: () => state.isTransforming,
  };
}
