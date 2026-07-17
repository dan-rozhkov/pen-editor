import type { SceneState } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDragStore } from "@/store/dragStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { isFitContentFrame } from "@/types/scene";
import { computeRasterCacheDecisions } from "./rasterCache";
import { requestCanvasRender } from "./renderScheduler";
import { isOverviewScale } from "./viewportCulling";
import type { SceneDiff } from "./syncDiff";

// The decision timer (Task 12's QUIET_MS is the *quiet* threshold; this is
// the round-trip cadence at which we re-evaluate it).
const DECISION_INTERVAL_MS = 600;

/**
 * Minimal surface of pixi.js's `Container` this module depends on — kept
 * narrow (rather than importing `Container` directly) so unit tests can pass
 * plain mock objects instead of real PixiJS containers.
 */
export interface CacheableContainer {
  cacheAsTexture(value: boolean | { resolution?: number; antialias?: boolean }): void;
}

export interface RasterCacheManagerDeps {
  getContainer(id: string): CacheableContainer | null;
  getState(): SceneState;
  getScale(): number;
  /**
   * Bug 1a (field report): a frame with at least one culled (renderable
   * false, non-mask) descendant at any depth must never be cached — caching
   * it would bake the currently-hidden content into the texture, which then
   * renders as permanently-missing layers once panning/zooming reveals that
   * content again (culling never evicts caches on its own). Optional —
   * callers/tests that don't exercise culling default to "never culled".
   */
  hasCulledContent?(frameId: string, state: SceneState): boolean;
}

export interface RasterCacheManager {
  /**
   * MUST run inside `flushSceneUpdate` AFTER the diff is computed but BEFORE
   * `incrementalUpdate` applies container updates. A cached subtree must drop
   * its texture synchronously here, before any container inside it is
   * mutated — this ordering is the fix for the historical stale-visual bug
   * that got `cacheAsTexture` disabled at frameRenderer.ts (ghost copies left
   * behind after structural reparent/move operations because the stale
   * texture was never invalidated before the mutation landed).
   */
  onFlushStart(diff: SceneDiff, state: SceneState): void;
  /**
   * For container mutations that happen *outside* a scene-store flush and so
   * never appear in any `SceneDiff` — `incrementalThemeUpdate`'s variable/style
   * recoloring (THEME_SENTINEL) and `autoLayoutDragAnimator`'s direct
   * position lerps are the two known cases. Must be called synchronously
   * BEFORE the mutation lands, same as `onFlushStart` — a cached top frame
   * covering one of `ids` has to drop its texture first, or it keeps
   * rendering its pre-mutation GPU snapshot indefinitely (nothing else ever
   * marks it dirty, since by construction no scene diff observed this
   * mutation).
   */
  onDirectContainerMutation(ids: Iterable<string>, state: SceneState): void;
  /** Zoom (or other viewport) change — schedules a decision round so a
   *  resolution-bucket change gets picked up. */
  onViewportChange(): void;
  /** Containers were destroyed and recreated (fullRebuild / render-mode
   *  rebuild) — the old `cached`/`dirtyAt` bookkeeping refers to containers
   *  that no longer exist and must be dropped, not replayed against the new
   *  ones. */
  onRebuild(): void;
  /**
   * Ids of top-level frames currently holding a live cached texture. Used by
   * the culling side (Bug 1c) to evict everything on an overview scale flip,
   * since at that point every cached frame's overview-effect-visibility
   * state just changed underneath it.
   */
  cachedFrameIds(): string[];
  dispose(): void;
}

export function createRasterCacheManager(deps: RasterCacheManagerDeps): RasterCacheManager {
  const dirtyAt = new Map<string, number>();
  const cached = new Map<string, { resolutionBucket: number }>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const topFrameOf = (id: string, state: SceneState): string | null => {
    // A removed id has no entry in nodesById — its own top ancestor is gone
    // along with it, and the parent that lost it is separately covered by
    // its own childrenById change (already in the same diff/mutation's ids).
    // Walking parentById for a dead id would otherwise resolve to whatever
    // (possibly unrelated) node currently occupies that id's stale parent
    // chain, or loop against no-longer-consistent state.
    if (!state.nodesById[id]) return null;
    let cur: string | null = id;
    while (cur != null && state.parentById[cur] != null) cur = state.parentById[cur];
    return cur;
  };

  const uncache = (id: string): void => {
    const c = deps.getContainer(id);
    if (c) c.cacheAsTexture(false);
    cached.delete(id);
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(applyDecisions, DECISION_INTERVAL_MS);
  };

  /**
   * Shared by `onFlushStart` (ids = a `SceneDiff`'s `changedIds`) and
   * `onDirectContainerMutation` (ids = whatever a non-diff mutation touched):
   * mark each id's top frame freshly dirty (restarts its QUIET_MS window)
   * and, if it's currently cached, drop the texture synchronously.
   */
  const markDirtyAndUncache = (ids: Iterable<string>, state: SceneState): void => {
    const now = performance.now();
    for (const id of ids) {
      const top = topFrameOf(id, state);
      if (!top) continue;
      dirtyAt.set(top, now);
      if (cached.has(top)) uncache(top);
    }
  };

  function applyDecisions(): void {
    timer = null;
    // Never (un)cache mid-drag: a live drag mutates containers directly
    // (autoLayoutDragAnimator) outside the normal flush path, and swapping a
    // cache mid-gesture would either show a stale frame for a tick or cause
    // visible churn.
    if (useDragStore.getState().isDragging) return;
    // Present mode is read-only (canEditScene requires "edit") and any churn
    // here would show up as visible flicker to the audience — treat the
    // whole scene as hot for the duration of the presentation. Existing
    // caches from before entering present mode stay valid (nothing can
    // mutate their contents while presenting) so leaving them alone is safe.
    if (useEditorModeStore.getState().mode === "present") return;

    const state = deps.getState();
    const scale = deps.getScale();
    const selection = useSelectionStore.getState();
    const hot = new Set<string>();
    for (const id of selection.selectedIds) {
      const top = topFrameOf(id, state);
      if (top) hot.add(top);
    }
    if (selection.editingNodeId) {
      const top = topFrameOf(selection.editingNodeId, state);
      if (top) hot.add(top);
    }

    // Task 3 (fit_content sizing gate): a fit_content top-level frame's
    // rendered size is the *live* Yoga-computed intrinsic size, never
    // written back to `width`/`height` here — the fits-gate below would
    // read stale stored dimensions while `cacheAsTexture` rasterizes the
    // live (possibly different) bounds. Excluded from caching eligibility
    // entirely rather than risking a wrongly-sized cached texture.
    const topLevelFrameIds = state.rootIds.filter((id) => {
      const n = state.nodesById[id];
      return n?.type === "frame" && !isFitContentFrame(n);
    });

    // Bug 1a: never cache (and evict if already cached — reusing the
    // existing hot-frame handling below covers both) a frame in overview or
    // with any culled descendant. Folded into `hot` rather than filtered out
    // of `topLevelFrameIds` so the normal dirty/bucket-mismatch bookkeeping
    // below still runs for these ids once the condition clears.
    const overview = isOverviewScale(scale);
    for (const id of topLevelFrameIds) {
      if (overview || deps.hasCulledContent?.(id, state)) hot.add(id);
    }

    const framePixelSize = new Map(
      topLevelFrameIds.map((id) => {
        const n = state.nodesById[id];
        return [id, { width: (n?.width ?? 0) * scale, height: (n?.height ?? 0) * scale }] as const;
      }),
    );

    const decisions = computeRasterCacheDecisions({
      topLevelFrameIds,
      frameSubtreeDirtyAt: dirtyAt,
      cachedFrames: cached,
      hotFrameIds: hot,
      framePixelSize,
      scale,
      now: performance.now(),
    });

    for (const id of decisions.toUncache) uncache(id);
    for (const { id, resolutionBucket } of decisions.toCache) {
      const c = deps.getContainer(id);
      if (!c) continue;
      c.cacheAsTexture({ resolution: resolutionBucket, antialias: true });
      cached.set(id, { resolutionBucket });
    }
    if (decisions.toUncache.length > 0 || decisions.toCache.length > 0) {
      requestCanvasRender();
      // Progress was made this round (e.g. an uncache-on-bucket-change may
      // still need a follow-up round to re-cache once quiet) — schedule
      // another round to let it converge. If a round makes *no* changes,
      // fall through without rescheduling: an idle document must not keep
      // this timer firing forever.
      schedule();
    }
  }

  const onDirectContainerMutation = (ids: Iterable<string>, state: SceneState): void => {
    markDirtyAndUncache(ids, state);
    schedule();
  };

  return {
    // A SceneDiff's `changedIds` is just another set of ids that were
    // touched outside this manager's view — same handling as any other
    // direct container mutation.
    onFlushStart(diff: SceneDiff, state: SceneState): void {
      onDirectContainerMutation(diff.changedIds, state);
    },
    onDirectContainerMutation,
    onViewportChange(): void {
      schedule();
    },
    onRebuild(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // The containers these ids referred to are gone — don't call
      // cacheAsTexture on whatever (possibly unrelated) container the new
      // registry now maps the id to. Just drop the bookkeeping; the next
      // decision round starts clean.
      cached.clear();
      dirtyAt.clear();
    },
    cachedFrameIds(): string[] {
      return [...cached.keys()];
    },
    dispose(): void {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      for (const id of [...cached.keys()]) uncache(id);
    },
  };
}
