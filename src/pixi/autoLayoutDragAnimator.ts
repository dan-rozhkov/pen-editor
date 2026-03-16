import { getNodeContainer, getSceneRoot } from "./pixiSync";
import type { SiblingPosition } from "@/utils/dragUtils";
import type { Container } from "pixi.js";

const LERP_FACTOR = 0.15;
const DROP_DURATION_MS = 150;
const CONVERGENCE_THRESHOLD = 0.5;
const IDLE_CONVERGENCE_FRAMES = 3;

export interface AutoLayoutDragAnimatorConfig {
  draggedId: string;
  parentId: string;
  siblingIds: string[];
  /** No-gap layout positions for each sibling (positions as if dragged node is removed) */
  noGapPositions: Map<string, SiblingPosition>;
  /** Original layout positions for each sibling (with dragged node present, for cancel restore) */
  originalPositions: Map<string, SiblingPosition>;
  /** The size of the dragged element along the main axis */
  draggedMainAxisSize: number;
  gap: number;
  isHorizontal: boolean;
  /** Absolute (world) position of the dragged node at drag start */
  startAbsX: number;
  startAbsY: number;
  /** World position of cursor at drag start */
  startWorldX: number;
  startWorldY: number;
}

export interface AutoLayoutDragAnimator {
  start(config: AutoLayoutDragAnimatorConfig): void;
  updateCursorWorld(worldX: number, worldY: number): void;
  updateInsertIndex(index: number | null, isOutside: boolean): void;
  animateDrop(finalX: number, finalY: number): Promise<void>;
  cancel(): void;
  destroy(): void;
}

export function createAutoLayoutDragAnimator(): AutoLayoutDragAnimator {
  let config: AutoLayoutDragAnimatorConfig | null = null;
  let ghost: Container | null = null;
  let ghostOriginalParent: Container | null = null;
  let ghostOriginalIndex = 0;
  let rafId: number | null = null;
  let destroyed = false;

  // Current insert index for sibling animation
  let currentInsertIndex: number | null = null;
  let isOutside = false;

  // Convergence tracking — stop RAF when idle
  let convergedFrames = 0;

  // Current sibling animated positions (lerped)
  const siblingCurrentPositions = new Map<string, { x: number; y: number }>();

  // Reusable target positions map to avoid per-frame allocation
  const targetPositionsCache = new Map<string, SiblingPosition>();

  function computeTargetPositions(): void {
    if (!config) return;
    targetPositionsCache.clear();
    const insertIdx = isOutside ? null : currentInsertIndex;
    for (let j = 0; j < config.siblingIds.length; j++) {
      const id = config.siblingIds[j];
      const basePos = config.noGapPositions.get(id);
      if (!basePos) continue;
      if (insertIdx !== null && j >= insertIdx) {
        const shift = config.draggedMainAxisSize + config.gap;
        targetPositionsCache.set(id, {
          x: basePos.x + (config.isHorizontal ? shift : 0),
          y: basePos.y + (config.isHorizontal ? 0 : shift),
        });
      } else {
        targetPositionsCache.set(id, basePos);
      }
    }
  }

  function lerpSiblings(): boolean {
    if (!config) return true;

    computeTargetPositions();
    let allConverged = true;

    for (const [id, target] of targetPositionsCache) {
      const container = getNodeContainer(id);
      if (!container) continue;

      let current = siblingCurrentPositions.get(id);
      if (!current) {
        current = { x: container.position.x, y: container.position.y };
        siblingCurrentPositions.set(id, current);
      }

      const dx = target.x - current.x;
      const dy = target.y - current.y;

      if (Math.abs(dx) < CONVERGENCE_THRESHOLD && Math.abs(dy) < CONVERGENCE_THRESHOLD) {
        current.x = target.x;
        current.y = target.y;
      } else {
        current.x += dx * LERP_FACTOR;
        current.y += dy * LERP_FACTOR;
        allConverged = false;
      }

      container.position.set(current.x, current.y);
    }

    return allConverged;
  }

  function scheduleRaf(): void {
    if (rafId === null && !destroyed) {
      convergedFrames = 0;
      rafId = requestAnimationFrame(rafLoop);
    }
  }

  function rafLoop(): void {
    if (destroyed) return;
    const allConverged = lerpSiblings();

    if (allConverged) {
      convergedFrames++;
      if (convergedFrames >= IDLE_CONVERGENCE_FRAMES) {
        // All siblings converged — stop RAF loop until insert index changes
        rafId = null;
        return;
      }
    } else {
      convergedFrames = 0;
    }

    rafId = requestAnimationFrame(rafLoop);
  }

  function start(cfg: AutoLayoutDragAnimatorConfig): void {
    config = cfg;

    // Get ghost container and reparent to sceneRoot
    ghost = getNodeContainer(cfg.draggedId);
    const sceneRoot = getSceneRoot();
    if (!ghost || !sceneRoot) return;

    ghostOriginalParent = ghost.parent;
    ghostOriginalIndex = ghostOriginalParent
      ? ghostOriginalParent.children.indexOf(ghost)
      : 0;

    // Remove from frame parent, add to sceneRoot at world coords
    ghost.alpha = 0.5;
    sceneRoot.addChild(ghost);
    ghost.position.set(cfg.startAbsX, cfg.startAbsY);

    // Initialize sibling positions from their current container positions
    for (const id of cfg.siblingIds) {
      const container = getNodeContainer(id);
      if (container) {
        siblingCurrentPositions.set(id, {
          x: container.position.x,
          y: container.position.y,
        });
      }
    }

    // Start RAF loop for sibling lerping
    scheduleRaf();
  }

  function updateCursorWorld(worldX: number, worldY: number): void {
    if (!config || !ghost) return;

    const deltaX = worldX - config.startWorldX;
    const deltaY = worldY - config.startWorldY;
    ghost.position.set(config.startAbsX + deltaX, config.startAbsY + deltaY);
  }

  function updateInsertIndex(index: number | null, outside: boolean): void {
    if (currentInsertIndex === index && isOutside === outside) return;
    currentInsertIndex = index;
    isOutside = outside;
    // Restart RAF loop if it was idle due to convergence
    scheduleRaf();
  }

  function animateDrop(finalX: number, finalY: number): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!ghost || !config) {
        resolve();
        return;
      }

      // Stop the sibling RAF loop — we'll run a combined one for the drop
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      const startTime = performance.now();
      const startX = ghost.position.x;
      const startY = ghost.position.y;

      const dropLoop = (now: number): void => {
        if (destroyed) {
          resolve();
          return;
        }

        const elapsed = now - startTime;
        const t = Math.min(elapsed / DROP_DURATION_MS, 1);
        // Ease out cubic
        const ease = 1 - Math.pow(1 - t, 3);

        if (ghost) {
          ghost.position.set(
            startX + (finalX - startX) * ease,
            startY + (finalY - startY) * ease,
          );
          ghost.alpha = 0.5 + 0.5 * ease;
        }

        // Also continue lerping siblings during drop
        lerpSiblings();

        if (t < 1) {
          rafId = requestAnimationFrame(dropLoop);
        } else {
          resolve();
        }
      };

      rafId = requestAnimationFrame(dropLoop);
    });
  }

  function restoreGhost(): void {
    if (!ghost) return;

    ghost.alpha = 1;

    // Reparent back to original parent
    if (ghostOriginalParent && !ghostOriginalParent.destroyed) {
      ghostOriginalParent.addChildAt(
        ghost,
        Math.min(ghostOriginalIndex, ghostOriginalParent.children.length),
      );
    }

    ghost = null;
  }

  function cancel(): void {
    if (!config) return;

    // Stop animations
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Restore ghost to original position in parent
    restoreGhost();

    // Snap siblings back to their original positions (with dragged node present)
    for (const id of config.siblingIds) {
      const container = getNodeContainer(id);
      const pos = config.originalPositions.get(id);
      if (container && pos) {
        container.position.set(pos.x, pos.y);
      }
    }

    siblingCurrentPositions.clear();
    targetPositionsCache.clear();
    config = null;
  }

  function destroy(): void {
    destroyed = true;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Restore ghost alpha and reparent if still floating
    if (ghost) {
      restoreGhost();
    }

    siblingCurrentPositions.clear();
    targetPositionsCache.clear();
    config = null;
  }

  return {
    start,
    updateCursorWorld,
    updateInsertIndex,
    animateDrop,
    cancel,
    destroy,
  };
}
