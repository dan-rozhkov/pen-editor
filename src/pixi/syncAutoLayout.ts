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

export interface CullingEvictionDeps {
  /**
   * Bug 1b/1c (field report — cached frames baking culled/hidden state):
   * called with ids whose culling divergence just resolved and therefore
   * need their (possibly stale) raster cache invalidated. The caller is
   * expected to wire this to `rasterCacheManager.onDirectContainerMutation`
   * (a no-op for ids not under a cached top frame, so this can be called
   * liberally).
   */
  onCullingEviction?: (ids: string[]) => void;
  /**
   * Bug 1c: ids of every top-level frame currently holding a live cached
   * texture — read on an overview-scale flip so every one of them can be
   * evicted via `onCullingEviction` (their overview-effect-visibility state
   * just changed underneath them).
   */
  getCachedFrameIds?: () => string[];
}

/**
 * Computes auto-layout positions/sizes for frame children and applies viewport
 * culling on root containers. Both operate over the live PixiJS registry.
 */
export function createAutoLayoutManager(ctx: SyncContext, cullingEviction?: CullingEvictionDeps) {
  const { registry, cullingIndex } = ctx;
  const { onCullingEviction, getCachedFrameIds } = cullingEviction ?? {};

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

      // Bug 1b (field report): ids whose renderable state flips false->true
      // this pass ("shown") — a raster cache covering one of these may have
      // baked its prior (culled/hidden) state into the texture, and culling
      // itself never evicts caches. Collected so the caller can invalidate.
      const shownIds: string[] = [];

      for (const id of visible) {
        const wasVisible = lastVisible.has(id);
        if (wasVisible && !overviewFlipped) continue; // state unchanged
        const entry = registry.get(id);
        if (!entry) continue;
        applyOverviewEffectVisibility(entry.container, overview);
        // Sibling-mask resolution exclusively owns mask-node renderability.
        // Overwriting it here can resurrect an inert masker or suppress a mask
        // Pixi needs for the stencil pass.
        if (!entry.node.isMask) entry.container.renderable = true;
        if (!wasVisible) shownIds.push(id);
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

      // Bug 1c: an overview flip changes overview-effect visibility on every
      // currently-visible id at once — any cached top frame needs its
      // texture invalidated, not just the ids that individually flipped
      // renderable this pass (a frame can be fully visible, unaffected by
      // the show/hide loops above, yet still have effect layers whose
      // rendered state just changed).
      if (overviewFlipped) {
        const cachedIds = getCachedFrameIds?.() ?? [];
        if (cachedIds.length > 0) onCullingEviction?.(cachedIds);
      } else if (shownIds.length > 0) {
        onCullingEviction?.(shownIds);
      }
    });
  }

  /**
   * Bug 1a dep: does `frameId`'s subtree (at any depth) contain a descendant
   * whose container is currently non-renderable due to culling? Used to gate
   * raster-cache eligibility — caching a frame with culled content would
   * bake the hidden state into the texture (culling never evicts caches on
   * its own, so that hole would persist until an unrelated eviction).
   *
   * Deliberately reads live container state (`container.renderable`) rather
   * than replicating `cullingIndex`'s visible-set membership semantics: a
   * descendant covered by a rotated ancestor's AABB is, by design, absent
   * from the visible set's per-id membership even though it's genuinely
   * on-screen (see cullingIndex.ts) — treating that absence as "culled"
   * would be wrong. Reading `renderable` directly sidesteps that distinction
   * entirely, since `updateCulling` only ever sets it false for ids actually
   * meant to be hidden.
   *
   * Only meaningful when the frame itself is visible — if the frame isn't
   * currently visible, there's no baked-hole divergence to speak of yet.
   */
  function hasCulledDescendant(frameId: string, state: SceneState): boolean {
    if (!lastVisible.has(frameId)) return false;
    const stack: string[] = [...(state.childrenById[frameId] ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const entry = registry.get(id);
      if (entry && !entry.node.isMask && entry.container.renderable === false) {
        return true;
      }
      for (const childId of state.childrenById[id] ?? []) stack.push(childId);
    }
    return false;
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

  /**
   * Snap a frame's direct children back to their stored positions/sizes when
   * that frame stops being auto-layout — undo of "enable auto layout", the
   * disable-auto-layout button, clearing `layout.autoLayout`, or retyping the
   * frame to another node type.
   *
   * Auto-layout positions/sizes are written straight onto child *containers*
   * by `applyAutoLayoutPositions`, out-of-band from each child's stored
   * `x/y/width/height`. Nothing un-applies them: toggling a frame's
   * auto-layout never moves the children's stored coordinates, so the
   * incremental diff sees each child node as unchanged (or, on undo, changed
   * to the very same stored values) and `updateNodeContainer` skips
   * repositioning. The container therefore keeps its stale yoga position until
   * the next full rebuild (e.g. switching pages). This pass detects frames
   * leaving auto-layout and resets their direct children so the canvas
   * updates immediately.
   */
  function resetFramesLeavingAutoLayout(
    state: SceneState,
    prev: SceneState,
    changedIds: Set<string>,
  ): void {
    for (const id of changedIds) {
      const prevNode = prev.nodesById[id];
      // Only frames that *were* auto-layout can have stale yoga positions to undo.
      if (!prevNode || !isFlatFrameNode(prevNode) || !prevNode.layout?.autoLayout) {
        continue;
      }
      const node = state.nodesById[id];
      // Still an auto-layout frame → its children are (correctly) yoga-positioned.
      if (node && isFlatFrameNode(node) && node.layout?.autoLayout) continue;

      for (const childId of state.childrenById[id] ?? []) {
        const childNode = state.nodesById[childId];
        const childEntry = registry.get(childId);
        if (!childNode || !childEntry) continue;
        // Position within the now-plain parent is always the child's stored x/y.
        childEntry.container.position.set(childNode.x, childNode.y);
        // Size: only restore stored dimensions for leaf-ish children. A child
        // that is *itself* an auto-layout frame owns its own display size via
        // its layout (e.g. fit_content, which diverges from the stored size) —
        // forcing the stored size here would clobber that. Its position moving
        // with the parent is enough; its own layout keeps its size.
        if (isFlatFrameNode(childNode) && childNode.layout?.autoLayout) continue;
        withAncestorThemes(childId, state.parentById, state.nodesById, () => {
          applyLayoutSize(
            childEntry.container,
            childNode,
            childNode.width,
            childNode.height,
            state.nodesById,
            state.childrenById,
          );
        });
      }
    }
  }

  return {
    updateCulling,
    resetCullingState,
    collectDirtyAutoLayoutFrames,
    applyAutoLayoutPositions,
    resetFramesLeavingAutoLayout,
    hasCulledDescendant,
  };
}
