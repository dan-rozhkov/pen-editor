import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useMeasureStore } from "@/store/measureStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { getNodeAbsolutePositionWithLayout, getNodeEffectiveSize, isDescendantOfFlat } from "@/utils/nodeUtils";
import { computeMeasurementLines, measureLineEndpoints } from "@/utils/measureUtils";
import { distanceToSegment } from "@/utils/geometryUtils";
import { formatMeasureLine } from "@/lib/inspect/units";
import { findCanvasHitTargetAtPoint } from "./hitTesting";
import type { InteractionContext, MeasureToolState } from "./types";

export interface MeasureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** World-point → node id (or null on a miss). Instance descendants are ignored. */
type HitTestFn = (worldX: number, worldY: number) => string | null;
/** Resolve a node's absolute draw rect (world coords). Null if unresolvable. */
type GetRectFn = (nodeId: string) => MeasureRect | null;

export interface MeasureToolControllerOverrides {
  hitTest?: HitTestFn;
  getRect?: GetRectFn;
}

export interface MeasureToolController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isActive: () => boolean;
}

// Hit-test tolerance for selecting an existing measurement's line, in world
// units — divided by scale by the caller so it stays a constant screen size.
const SEGMENT_HIT_TOLERANCE_SCREEN_PX = 6;

function defaultHitTest(worldX: number, worldY: number): string | null {
  const target = findCanvasHitTargetAtPoint(worldX, worldY);
  return target?.kind === "node" ? target.nodeId : null;
}

function defaultGetRect(nodeId: string): MeasureRect | null {
  const state = useSceneStore.getState();
  const node = state.nodesById[nodeId];
  if (!node) return null;
  const nodes = state.getNodes();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const pos = getNodeAbsolutePositionWithLayout(nodes, nodeId, calculateLayoutForFrame);
  if (!pos) return null;
  const size = getNodeEffectiveSize(nodes, nodeId, calculateLayoutForFrame);
  return {
    x: pos.x,
    y: pos.y,
    width: size?.width ?? node.width,
    height: size?.height ?? node.height,
  };
}

/** Determine parent/child vs sibling geometry from the flat parent map. */
function resolveRelation(
  parentById: Record<string, string | null>,
  fromId: string,
  toId: string,
): "from-is-ancestor" | "to-is-ancestor" | "sibling" {
  if (isDescendantOfFlat(parentById, fromId, toId)) return "from-is-ancestor";
  if (isDescendantOfFlat(parentById, toId, fromId)) return "to-is-ancestor";
  return "sibling";
}

/**
 * Persistent measure tool (Shift+M): pointerDown on a node records the "from"
 * endpoint; pointerUp on a different node pins a measurement (`addMeasurement`).
 * A pointerDown that misses every node instead hit-tests existing pinned
 * measurements' line geometry and selects the nearest one within tolerance
 * (or clears selection on a total miss). Mirrors `createMarqueeController`'s
 * closure-state-machine shape; `hitTest`/`getRect` are injectable for tests.
 */
export function createMeasureToolController(
  _context: InteractionContext,
  overrides?: MeasureToolControllerOverrides,
): MeasureToolController {
  const hitTest = overrides?.hitTest ?? defaultHitTest;
  const getRect = overrides?.getRect ?? defaultGetRect;

  const state: MeasureToolState = {
    fromId: null,
    isActive: false,
  };

  function selectNearestMeasurement(worldX: number, worldY: number): void {
    const scale = useViewportStore.getState().scale || 1;
    const tolerance = SEGMENT_HIT_TOLERANCE_SCREEN_PX / scale;
    const { measurements, setSelectedMeasurement } = useMeasurementsStore.getState();
    const parentById = useSceneStore.getState().parentById;

    let bestId: string | null = null;
    let bestDist = Infinity;

    for (const m of measurements) {
      const fromRect = getRect(m.fromId);
      const toRect = getRect(m.toId);
      if (!fromRect || !toRect) continue;

      const relation = resolveRelation(parentById, m.fromId, m.toId);
      const lines = computeMeasurementLines(fromRect, toRect, relation);
      for (const line of lines) {
        const { x1, y1, x2, y2 } = measureLineEndpoints(line);
        const dist = distanceToSegment(worldX, worldY, x1, y1, x2, y2);
        if (dist < bestDist) {
          bestDist = dist;
          bestId = m.id;
        }
      }
    }

    setSelectedMeasurement(bestId !== null && bestDist <= tolerance ? bestId : null);
  }

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (useDrawModeStore.getState().activeTool !== "measure" || e.button !== 0) {
        return false;
      }

      const hitId = hitTest(world.x, world.y);
      if (hitId) {
        state.fromId = hitId;
        state.isActive = true;
        return true;
      }

      // Miss: try selecting an existing pinned measurement instead.
      selectNearestMeasurement(world.x, world.y);
      return true;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!state.isActive || !state.fromId) return false;

      const hoveredId = hitTest(world.x, world.y);
      if (!hoveredId || hoveredId === state.fromId) {
        useMeasureStore.getState().clearLines();
        return true;
      }

      const fromRect = getRect(state.fromId);
      const toRect = getRect(hoveredId);
      if (!fromRect || !toRect) {
        useMeasureStore.getState().clearLines();
        return true;
      }

      const parentById = useSceneStore.getState().parentById;
      const relation = resolveRelation(parentById, state.fromId, hoveredId);
      const lines = computeMeasurementLines(fromRect, toRect, relation);
      const devMode = useDevModeStore.getState();
      useMeasureStore
        .getState()
        .setLines(lines.map((line) => formatMeasureLine(line, devMode.units, devMode.remBase)));
      return true;
    },

    handlePointerUp(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!state.isActive) return false;

      useMeasureStore.getState().clearLines();

      const hoveredId = hitTest(world.x, world.y);
      if (hoveredId && state.fromId && hoveredId !== state.fromId) {
        useMeasurementsStore.getState().addMeasurement(state.fromId, hoveredId);
      }

      state.isActive = false;
      state.fromId = null;
      return true;
    },

    isActive: () => state.isActive,
  };
}
