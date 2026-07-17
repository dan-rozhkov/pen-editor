import type { SceneState } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useDragStore } from "@/store/dragStore";
import { useViewportStore } from "@/store/viewportStore";
import { isFlatFrameNode } from "@/types/scene";
import { materializeLayoutRefs } from "@/utils/layoutRefUtils";
import { calculateFrameIntrinsicSize } from "@/utils/yogaLayout";
import { getViewportBounds } from "@/utils/viewportUtils";
import { applyLayoutSize } from "./renderers";
import { applyOverviewEffectVisibility, isOverviewScale } from "./viewportCulling";
import {
  type SyncContext,
  type NodeLayoutOverride,
  type AutoLayoutFrameSet,
  withAncestorThemes,
  flatToTreeFrame,
} from "./syncHelpers";
import { perfStats } from "./perfStats";

// Phase 1: Viewport culling — screen-space margin to avoid pop-in during fast panning
const CULL_MARGIN = 400;

/**
 * Computes auto-layout positions/sizes for frame children and applies viewport
 * culling on root containers. Both operate over the live PixiJS registry.
 */
export function createAutoLayoutManager(ctx: SyncContext) {
  const { registry, cullingIndex } = ctx;

  // ─── Phase 1: Viewport Culling ───────────────────────────────────────

  // Last-applied visible set + overview flag, kept across frames so an
  // unchanged viewport/scene touches zero containers: only ids whose
  // visible/culled state actually flips (or the overview flag flips) get
  // `.renderable` re-applied, instead of walking every entry every frame.
  let lastVisible = new Set<string>();
  let lastOverview: boolean | null = null;

  /**
   * @param settleIds Ids whose container was just created (added this flush,
   * or every node on a full rebuild) and therefore carries no prior
   * `.renderable` state from a previous `updateCulling` pass. The
   * visible/lastVisible diff below only ever *changes* state for ids whose
   * membership flipped — a brand-new container that's culled from birth
   * never appears in `visible` (so the "show" loop skips it) and never
   * appeared in `lastVisible` either (so the "hide" loop skips it too),
   * leaving Pixi's default `renderable = true` in place. `settleIds` closes
   * that gap: anything in it not already handled by the "show" loop gets an
   * explicit `renderable = false`.
   */
  function updateCulling(settleIds?: Iterable<string>): void {
    perfStats.time("updateCulling", () => {
      const { scale, x, y } = useViewportStore.getState();
      const b = getViewportBounds(scale, x, y, window.innerWidth, window.innerHeight);
      const margin = CULL_MARGIN / scale;
      const bounds = {
        minX: b.minX - margin,
        minY: b.minY - margin,
        maxX: b.maxX + margin,
        maxY: b.maxY + margin,
      };

      const visible = cullingIndex.queryVisible(bounds);
      const overview = isOverviewScale(scale);
      const overviewFlipped = overview !== lastOverview;
      lastOverview = overview;

      for (const id of visible) {
        if (lastVisible.has(id) && !overviewFlipped) continue; // state unchanged
        const entry = registry.get(id);
        if (!entry) continue;
        applyOverviewEffectVisibility(entry.container, overview);
        // Sibling-mask resolution exclusively owns mask-node renderability.
        // Overwriting it here can resurrect an inert masker or suppress a mask
        // Pixi needs for the stencil pass.
        if (!entry.node.isMask) entry.container.renderable = true;
      }
      for (const id of lastVisible) {
        if (visible.has(id)) continue;
        const entry = registry.get(id);
        if (!entry) continue;
        if (!entry.node.isMask) entry.container.renderable = false;
      }
      if (settleIds) {
        for (const id of settleIds) {
          if (visible.has(id)) continue; // already forced true by the loop above
          const entry = registry.get(id);
          if (!entry) continue;
          if (!entry.node.isMask) entry.container.renderable = false;
        }
      }
      lastVisible = visible;
    });
  }

  /**
   * Forces the next `updateCulling()` call to (re-)apply overview-effect
   * state to every currently-visible id, instead of diffing against the
   * previous frame's set. Required after `fullRebuild` (font load,
   * render-mode toggle): every container is destroyed and recreated, so
   * per-container WeakMap-tracked overview effect state (shadow/blur
   * layers) starts fresh even for ids whose true/false visibility hasn't
   * changed — without this, an id that was already in `lastVisible` before
   * the rebuild would be skipped by the "show" loop and its brand-new
   * shadow/blur children would never get `applyOverviewEffectVisibility`
   * applied at all.
   */
  function resetCullingState(): void {
    lastVisible = new Set();
    lastOverview = null;
  }

  // ─── Auto-Layout ─────────────────────────────────────────────────────

  /**
   * Apply auto-layout positions to frame children
   */
  function collectDirtyAutoLayoutFrames(
    state: SceneState,
    changedIds: Set<string>,
  ): AutoLayoutFrameSet {
    const dirty = new Set<string>();

    const markAutoLayoutAncestors = (startId: string): void => {
      let current: string | null = startId;
      while (current != null) {
        const n = state.nodesById[current];
        if (n && isFlatFrameNode(n) && n.layout?.autoLayout) {
          dirty.add(current);
        }
        current = state.parentById[current] ?? null;
      }
    };

    for (const id of changedIds) {
      markAutoLayoutAncestors(id);
    }

    // Keep only top-most dirty auto-layout frames.
    const minimal = new Set<string>();
    for (const frameId of dirty) {
      let hasDirtyAncestor = false;
      let cur = state.parentById[frameId] ?? null;
      while (cur != null) {
        if (dirty.has(cur)) {
          hasDirtyAncestor = true;
          break;
        }
        cur = state.parentById[cur] ?? null;
      }
      if (!hasDirtyAncestor) minimal.add(frameId);
    }

    return minimal;
  }

  function applyAutoLayoutPositions(
    state: SceneState,
    dirtyFrames?: AutoLayoutFrameSet,
  ): void {
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const layoutOverrides = new Map<string, NodeLayoutOverride>();

    const applyFrameLayoutRecursively = (frameId: string): void => {
      const frameNode = state.nodesById[frameId];
      if (!frameNode || !isFlatFrameNode(frameNode)) return;

      // Skip frames being animated during auto-layout drag
      const dragState = useDragStore.getState();
      if (dragState.isDragging && dragState.animationPhase && dragState.insertInfo?.parentId === frameId) return;

      const childIds = state.childrenById[frameId] ?? [];
      const frameOverride = layoutOverrides.get(frameId);

      if (frameNode.layout?.autoLayout) {
        // Convert to tree structure for layout calculation, including overrides
        // inherited from parent auto-layout.
        const treeFrame = flatToTreeFrame(
          frameId,
          state.nodesById,
          state.childrenById,
          layoutOverrides,
        );

        if (treeFrame) {
          const layoutFrame = materializeLayoutRefs(
            treeFrame,
            state.nodesById,
            state.childrenById,
          );
          // Keep frame background/mask in sync for fit_content frames even when
          // only descendants changed (e.g. text metrics after font load).
          const fitWidth = frameNode.sizing?.widthMode === "fit_content";
          const fitHeight = frameNode.sizing?.heightMode === "fit_content";
          // Respect size computed by parent auto-layout when this frame is a child
          // (e.g. fill_container). Fallback to stored node size for roots/standalone.
          let frameWidth = frameOverride?.width ?? frameNode.width;
          let frameHeight = frameOverride?.height ?? frameNode.height;

          if (fitWidth || fitHeight) {
            const intrinsicSize = calculateFrameIntrinsicSize(layoutFrame, {
              fitWidth,
              fitHeight,
            });
            if (fitWidth) {
              frameWidth = frameNode.clip
                ? Math.min(intrinsicSize.width, frameNode.width)
                : intrinsicSize.width;
            }
            if (fitHeight) {
              frameHeight = frameNode.clip
                ? Math.min(intrinsicSize.height, frameNode.height)
                : intrinsicSize.height;
            }
          }

          const frameEntry = registry.get(frameId);
          if (frameEntry) {
            withAncestorThemes(
              frameId,
              state.parentById,
              state.nodesById,
              () => {
                applyLayoutSize(
                  frameEntry.container,
                  frameEntry.node,
                  frameWidth,
                  frameHeight,
                  state.nodesById,
                  state.childrenById,
                );
              },
            );
          }

          // Calculate layout
          const layoutChildren = calculateLayoutForFrame(layoutFrame);

          // Apply positions/sizes to child containers and cache overrides for nested frames.
          for (const layoutChild of layoutChildren) {
            layoutOverrides.set(layoutChild.id, {
              x: layoutChild.x,
              y: layoutChild.y,
              width: layoutChild.width,
              height: layoutChild.height,
            });

            const childEntry = registry.get(layoutChild.id);
            if (childEntry) {
              childEntry.container.position.set(layoutChild.x, layoutChild.y);
              withAncestorThemes(
                layoutChild.id,
                state.parentById,
                state.nodesById,
                () => {
                  applyLayoutSize(
                    childEntry.container,
                    childEntry.node,
                    layoutChild.width,
                    layoutChild.height,
                    state.nodesById,
                    state.childrenById,
                  );
                },
              );
            }
          }
        }
      }

      // Continue traversal so nested auto-layout frames also get processed.
      for (const childId of childIds) {
        const childNode = state.nodesById[childId];
        if (childNode?.type === "frame") {
          applyFrameLayoutRecursively(childId);
        }
      }
    };

    if (dirtyFrames && dirtyFrames.size > 0) {
      for (const frameId of dirtyFrames) {
        applyFrameLayoutRecursively(frameId);
      }
      return;
    }

    // Full pass from roots.
    for (const rootId of state.rootIds) {
      const rootNode = state.nodesById[rootId];
      if (rootNode?.type === "frame") {
        applyFrameLayoutRecursively(rootId);
      }
    }
  }

  return {
    updateCulling,
    resetCullingState,
    collectDirtyAutoLayoutFrames,
    applyAutoLayoutPositions,
  };
}
