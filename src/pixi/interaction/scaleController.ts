import { useSceneStore } from "@/store/sceneStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import type { ComponentArtifact, FlatSceneNode } from "@/types/scene";
import type { InteractionContext, TransformHandle } from "./types";
import { hitTestTransformHandle, getResizeCursor } from "./hitTesting";
import { computeScaleUpdates } from "@/store/sceneStore/scaleOperations";
import { saveHistory } from "@/store/sceneStore/helpers/history";

const MIN_SIZE = 5;

/**
 * Module-level handle to the active scale gesture's cancel function, so
 * out-of-band callers (Esc key handler, tool switches) can abort an
 * in-progress scale — the gesture state lives inside the controller closure
 * and isn't otherwise reachable. Mirrors the `cancelPenDraft`/`cancelDrag`
 * escape hatches used elsewhere.
 */
let activeScaleCancel: (() => void) | null = null;

/**
 * Abort an in-progress scale gesture: revert the live preview (no history)
 * and clear the gesture state. Returns true if a gesture was cancelled.
 */
export function cancelActiveScale(): boolean {
  if (!activeScaleCancel) return false;
  activeScaleCancel();
  return true;
}

/**
 * Scale tool (hotkey K). Reuses the existing 8-handle resize overlay/hit
 * testing, but instead of a plain (possibly non-uniform) resize, it applies
 * ONE uniform scale factor to the dragged node and its ENTIRE descendant
 * subtree — see `computeScaleUpdates` for the recursive walk and the
 * coordinate-composition reasoning (why scaling every node's own relative
 * x/y/width/height by the same factor is correct with no extra
 * per-descendant math).
 *
 * Live preview during the drag is recomputed from the pointer-down snapshot
 * every move (never incrementally) and applied without history; the final
 * factor is committed as a single history entry on pointer up, also
 * computed from that same original snapshot — so nothing here ever reads
 * back the live-mutated store and re-multiplies it (the classic
 * double-scaling bug this feature has to avoid).
 */
export interface ScaleController {
  handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerMove(e: PointerEvent, world: { x: number; y: number }): boolean;
  handlePointerUp(e: PointerEvent, world: { x: number; y: number }): boolean;
  isScaling: () => boolean;
}

interface ScaleState {
  isScaling: boolean;
  nodeId: string | null;
  corner: TransformHandle | null;
  startNodeX: number;
  startNodeY: number;
  startNodeW: number;
  startNodeH: number;
  absX: number;
  absY: number;
  parentOffsetX: number;
  parentOffsetY: number;
  originalNodesById: Record<string, FlatSceneNode> | null;
  originalChildrenById: Record<string, string[]> | null;
  originalParentById: Record<string, string | null> | null;
  originalRootIds: string[] | null;
  originalComponentArtifactsById: Record<string, ComponentArtifact> | null;
}

/** Fixed anchor corner (in absolute/world space) opposite the dragged handle. */
function anchorForCorner(
  corner: TransformHandle,
  absX: number,
  absY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const x = corner.includes("l") ? absX + width : absX;
  const y = corner.includes("b") ? absY : absY + height;
  return { x, y };
}

/** Uniform scale factor implied by dragging `corner` from its start position to `world`. */
function computeFactor(
  corner: TransformHandle,
  anchor: { x: number; y: number },
  startCorner: { x: number; y: number },
  world: { x: number; y: number },
  startW: number,
  startH: number,
): number {
  const hasX = corner === "l" || corner === "r" || corner.length === 2;
  const hasY = corner === "t" || corner === "b" || corner.length === 2;

  let ratio = 1;
  if (hasX && hasY) {
    const startDist = Math.hypot(startCorner.x - anchor.x, startCorner.y - anchor.y);
    const dist = Math.hypot(world.x - anchor.x, world.y - anchor.y);
    ratio = startDist > 0 ? dist / startDist : 1;
  } else if (hasX) {
    const startDist = Math.abs(startCorner.x - anchor.x);
    const dist = Math.abs(world.x - anchor.x);
    ratio = startDist > 0 ? dist / startDist : 1;
  } else {
    const startDist = Math.abs(startCorner.y - anchor.y);
    const dist = Math.abs(world.y - anchor.y);
    ratio = startDist > 0 ? dist / startDist : 1;
  }

  const minFactor = Math.max(MIN_SIZE / startW, MIN_SIZE / startH, 0.02);
  return Math.max(ratio, minFactor);
}

export function createScaleController(context: InteractionContext): ScaleController {
  const state: ScaleState = {
    isScaling: false,
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
    originalNodesById: null,
    originalChildrenById: null,
    originalParentById: null,
    originalRootIds: null,
    originalComponentArtifactsById: null,
  };

  function reset(): void {
    state.isScaling = false;
    state.nodeId = null;
    state.corner = null;
    state.originalNodesById = null;
    state.originalChildrenById = null;
    state.originalParentById = null;
    state.originalRootIds = null;
    state.originalComponentArtifactsById = null;
    activeScaleCancel = null;
    context.canvas.style.cursor = "";
  }

  /** Revert the live preview (restore the pointer-down snapshot) without history. */
  function cancel(): void {
    if (!state.isScaling) return;
    if (state.originalNodesById) {
      useSceneStore.setState({ nodesById: state.originalNodesById, _cachedTree: null });
    }
    reset();
  }

  /** The effective (layout) size the gesture measured — the scale base for the root. */
  function baseSizesFor(): Record<string, { width: number; height: number }> {
    return { [state.nodeId!]: { width: state.startNodeW, height: state.startNodeH } };
  }

  function factorAndAnchorFor(world: { x: number; y: number }): {
    factor: number;
    localAnchor: { x: number; y: number };
  } {
    const corner = state.corner!;
    const anchor = anchorForCorner(corner, state.absX, state.absY, state.startNodeW, state.startNodeH);
    const startCorner = {
      x: corner.includes("l") ? state.absX : state.absX + state.startNodeW,
      y: corner.includes("t") ? state.absY : state.absY + state.startNodeH,
    };
    const factor = computeFactor(corner, anchor, startCorner, world, state.startNodeW, state.startNodeH);
    // Anchor in the node's own parent-local coordinate space (matches how
    // node.x/y are stored) — same absolute→local conversion transformController uses.
    const localAnchor = { x: anchor.x - state.parentOffsetX, y: anchor.y - state.parentOffsetY };
    return { factor, localAnchor };
  }

  return {
    handlePointerDown(e: PointerEvent, world: { x: number; y: number }): boolean {
      if (e.button !== 0) return false;
      if (useDrawModeStore.getState().activeTool !== "scale") return false;

      const handleHit = hitTestTransformHandle(world.x, world.y);
      if (!handleHit || handleHit.slotContext) return false;

      const sceneState = useSceneStore.getState();
      const node = sceneState.nodesById[handleHit.nodeId];
      if (!node) return false;

      state.isScaling = true;
      state.nodeId = handleHit.nodeId;
      state.corner = handleHit.corner;
      state.startNodeX = node.x;
      state.startNodeY = node.y;
      state.startNodeW = handleHit.width;
      state.startNodeH = handleHit.height;
      state.absX = handleHit.absX;
      state.absY = handleHit.absY;
      state.parentOffsetX = handleHit.absX - node.x;
      state.parentOffsetY = handleHit.absY - node.y;
      state.originalNodesById = sceneState.nodesById;
      state.originalChildrenById = sceneState.childrenById;
      state.originalParentById = sceneState.parentById;
      state.originalRootIds = sceneState.rootIds;
      state.originalComponentArtifactsById = sceneState.componentArtifactsById;
      activeScaleCancel = cancel;
      context.canvas.style.cursor = getResizeCursor(handleHit.corner);
      return true;
    },

    handlePointerMove(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!state.isScaling || !state.nodeId || !state.corner || !state.originalNodesById || !state.originalChildrenById) {
        return false;
      }
      // Tool switched away mid-drag — abort rather than committing a scale.
      if (useDrawModeStore.getState().activeTool !== "scale") {
        cancel();
        return false;
      }

      const { factor, localAnchor } = factorAndAnchorFor(world);
      const updates = computeScaleUpdates(
        [state.nodeId],
        factor,
        state.originalNodesById,
        state.originalChildrenById,
        { [state.nodeId]: localAnchor },
        baseSizesFor(),
      );
      useSceneStore.getState().updateNodesWithoutHistory(updates);
      return true;
    },

    handlePointerUp(_e: PointerEvent, world: { x: number; y: number }): boolean {
      if (!state.isScaling || !state.nodeId || !state.corner || !state.originalNodesById || !state.originalChildrenById) {
        reset();
        return false;
      }
      // Tool switched away mid-drag — abort rather than committing a scale.
      if (useDrawModeStore.getState().activeTool !== "scale") {
        cancel();
        return true;
      }

      const { factor, localAnchor } = factorAndAnchorFor(world);
      const updates = computeScaleUpdates(
        [state.nodeId],
        factor,
        state.originalNodesById,
        state.originalChildrenById,
        { [state.nodeId]: localAnchor },
        baseSizesFor(),
      );

      // Commit as a single history entry, computed from the pointer-down
      // snapshot (not the live-mutated store) so the drag's WithoutHistory
      // preview writes never get scaled a second time here.
      saveHistory({
        nodesById: state.originalNodesById,
        parentById: state.originalParentById!,
        childrenById: state.originalChildrenById,
        rootIds: state.originalRootIds!,
        componentArtifactsById: state.originalComponentArtifactsById ?? undefined,
      });
      const newNodesById = { ...state.originalNodesById };
      for (const id in updates) {
        newNodesById[id] = { ...newNodesById[id], ...updates[id] } as FlatSceneNode;
      }
      useSceneStore.setState({ nodesById: newNodesById, _cachedTree: null });

      reset();
      return true;
    },

    isScaling: () => state.isScaling,
  };
}
