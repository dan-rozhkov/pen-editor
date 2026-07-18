import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRasterCacheManager, type CacheableContainer } from "../rasterCacheManager";
import type { SceneDiff } from "../syncDiff";
import type { SceneState } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDragStore } from "@/store/dragStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { QUIET_MS } from "../rasterCache";

// A minimal frame node shape — only the fields computeRasterCacheDecisions
// and rasterCacheManager read.
function frameNode(width = 1440, height = 900) {
  return { type: "frame", width, height } as unknown as SceneState["nodesById"][string];
}

// Only `ids` are top-level frames in this state — kept deliberately narrow
// so a test's container map (which drives `getContainer`) always covers
// every frame the manager will consider, and a frame never gets stuck
// perpetually "toCache" just because no mock container backs it.
function makeState(ids: string[] = ["f1"], overrides: Partial<SceneState> = {}): SceneState {
  const nodesById: SceneState["nodesById"] = {};
  const parentById: SceneState["parentById"] = {};
  for (const id of ids) {
    nodesById[id] = frameNode();
    parentById[id] = null;
  }
  return {
    nodesById,
    parentById,
    childrenById: {},
    rootIds: [...ids],
    componentArtifactsById: {},
    _cachedTree: null,
    expandedFrameIds: new Set(),
    pageBackground: "#fff",
    slideOrder: [],
    getNodes: () => [],
    ...overrides,
  } as SceneState;
}

type CacheAsTextureFn = CacheableContainer["cacheAsTexture"];

function makeContainer(): CacheableContainer & { cacheAsTexture: ReturnType<typeof vi.fn<CacheAsTextureFn>> } {
  return { cacheAsTexture: vi.fn<CacheAsTextureFn>() };
}

function diffFor(ids: string[]): SceneDiff {
  return { changedIds: new Set(ids), addedIds: [], removedIds: [], updatedIds: [...ids] };
}

describe("createRasterCacheManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSelectionStore.setState({ selectedIds: [], editingNodeId: null });
    useDragStore.setState({ isDragging: false });
    useEditorModeStore.setState({ mode: "edit" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(containers: Record<string, ReturnType<typeof makeContainer>>) {
    const ids = Object.keys(containers);
    const state = makeState(ids);
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => containers[id] ?? null);
    const manager = createRasterCacheManager({ getContainer, getState, getScale });
    return { manager, state, getContainer, getState };
  }

  it("caches quiet frames after the decision round, once past QUIET_MS", () => {
    const c1 = makeContainer();
    const c2 = makeContainer();
    const { manager, state } = setup({ f1: c1, f2: c2 });

    manager.onFlushStart(diffFor(["f1"]), state);
    // Not yet quiet — advancing less than QUIET_MS must not cache.
    vi.advanceTimersByTime(QUIET_MS - 50);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();

    // Cross QUIET_MS and let the 600ms decision timer fire.
    vi.advanceTimersByTime(600);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 1, antialias: true });
    expect(c2.cacheAsTexture).toHaveBeenCalledWith({ resolution: 1, antialias: true });
  });

  it("onFlushStart uncaches synchronously (before any timer fires) when a cached frame goes dirty again", () => {
    const c1 = makeContainer();
    const { manager } = setup({ f1: c1 });

    manager.onFlushStart(diffFor(["f1"]), makeState());
    vi.advanceTimersByTime(600 + QUIET_MS);
    expect(c1.cacheAsTexture).toHaveBeenLastCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();

    // f1 mutated again — the uncache must happen synchronously inside
    // onFlushStart, not on the next timer tick.
    manager.onFlushStart(diffFor(["f1"]), makeState());
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false);
  });

  it("onDirectContainerMutation evicts a cached frame synchronously (theme/style recolor path)", () => {
    // f1 is the top frame; n1 is a variable-dependent descendant that
    // incrementalThemeUpdate recolors directly (THEME_SENTINEL), with no
    // scene mutation and therefore no SceneDiff — onFlushStart never sees it.
    const c1 = makeContainer();
    const state = makeState(["f1"]);
    state.nodesById["n1"] = { type: "rect", width: 10, height: 10 } as unknown as SceneState["nodesById"][string];
    state.parentById["n1"] = "f1";
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const manager = createRasterCacheManager({ getContainer, getState, getScale });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600); // caches f1
    expect(c1.cacheAsTexture).toHaveBeenLastCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();

    // Variable/style store change: recolor n1 directly, no scene diff.
    manager.onDirectContainerMutation(["n1"], state);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false); // synchronous, not on the next timer tick
  });

  it("onDirectContainerMutation evicts the dragged node's cached top frame at drag start", () => {
    // Simulates pixiSync's isDragging false->true hook: autoLayoutDragAnimator
    // is about to lerp containers on every RAF frame outside the store, so
    // the dragged node's top frame must drop its cache before that starts.
    const c1 = makeContainer();
    const state = makeState(["f1"]);
    state.nodesById["dragged-node"] = { type: "rect", width: 10, height: 10 } as unknown as SceneState["nodesById"][string];
    state.parentById["dragged-node"] = "f1";
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const manager = createRasterCacheManager({ getContainer, getState, getScale });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600); // caches f1
    expect(c1.cacheAsTexture).toHaveBeenLastCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();

    manager.onDirectContainerMutation(["dragged-node"], state);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false);

    // And it must stay uncached for the whole gesture: applyDecisions bails
    // completely while isDragging, so no amount of waiting re-caches it.
    useDragStore.setState({ isDragging: true });
    c1.cacheAsTexture.mockClear();
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  it("never (un)caches mid-drag", () => {
    const c1 = makeContainer();
    const { manager } = setup({ f1: c1 });

    manager.onFlushStart(diffFor(["f1"]), makeState());
    useDragStore.setState({ isDragging: true });
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  it("treats present mode as globally hot — no caching churn while presenting", () => {
    const c1 = makeContainer();
    const { manager } = setup({ f1: c1 });

    useEditorModeStore.setState({ mode: "present" });
    manager.onFlushStart(diffFor(["f1"]), makeState());
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  it("treats selected/editing top frames as hot — never caches them", () => {
    const c1 = makeContainer();
    const { manager } = setup({ f1: c1 });

    useSelectionStore.setState({ selectedIds: ["f1"], editingNodeId: null });
    manager.onFlushStart(diffFor(["f1"]), makeState());
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  it("dispose() clears the timer and uncaches every currently-cached frame", () => {
    const c1 = makeContainer();
    const c2 = makeContainer();
    const { manager } = setup({ f1: c1, f2: c2 });

    manager.onFlushStart(diffFor(["f1", "f2"]), makeState());
    vi.advanceTimersByTime(600 + QUIET_MS);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();
    c2.cacheAsTexture.mockClear();

    manager.dispose();
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false);
    expect(c2.cacheAsTexture).toHaveBeenCalledWith(false);

    // Timer must be cleared too — advancing time must trigger no further calls.
    c1.cacheAsTexture.mockClear();
    c2.cacheAsTexture.mockClear();
    vi.advanceTimersByTime(5000);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
    expect(c2.cacheAsTexture).not.toHaveBeenCalled();
  });

  it("onRebuild drops bookkeeping without touching containers, and stops the pending timer", () => {
    const c1 = makeContainer();
    const { manager, getContainer } = setup({ f1: c1 });

    manager.onFlushStart(diffFor(["f1"]), makeState());
    vi.advanceTimersByTime(600 + QUIET_MS);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();
    getContainer.mockClear();

    manager.onRebuild();
    // No container calls made just from resetting bookkeeping.
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();

    // Advancing time triggers nothing — the timer was cleared, not merely
    // left to fire against stale bookkeeping.
    vi.advanceTimersByTime(5000);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();

    // A subsequent flush must be able to re-cache f1 from scratch (dirtyAt
    // was cleared, not left pointing at a stale timestamp).
    manager.onFlushStart(diffFor(["f1"]), makeState());
    vi.advanceTimersByTime(600 + QUIET_MS);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 1, antialias: true });
  });

  it("idle timer does not keep firing once a round makes no further changes", () => {
    const c1 = makeContainer();
    const { manager, getState } = setup({ f1: c1 });

    manager.onFlushStart(diffFor(["f1"]), makeState());
    // Round 1: caches f1 — a round that makes a change reschedules once more
    // to let bookkeeping converge.
    vi.advanceTimersByTime(600);
    expect(c1.cacheAsTexture).toHaveBeenCalledTimes(1);
    getState.mockClear();

    // Round 2: f1 is already cached, quiet, and at the right bucket — no
    // change, so this round must be the last one scheduled.
    vi.advanceTimersByTime(600);
    expect(getState).toHaveBeenCalledTimes(1);
    c1.cacheAsTexture.mockClear();
    getState.mockClear();

    // Nothing scheduled anything further — advancing a long time must not
    // invoke deps.getState() again (the timer was not rescheduled).
    vi.advanceTimersByTime(10_000);
    expect(getState).not.toHaveBeenCalled();
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  it("onViewportChange schedules a round that uncaches on bucket change and re-caches after quiet", () => {
    const c1 = makeContainer();
    // `frameSize` carries RAW stored width/height; the fit check is
    // `width * resolutionBucket <= MAX_TEXTURE_PX` (cacheAsTexture's
    // `resolution` applies to local units — zoom does NOT multiply into the
    // texture size). Zoom only picks the bucket, via scale * pixelRatio.
    const state = makeState(["f1"], { nodesById: { f1: frameNode(100, 80) } });
    const getState = vi.fn<() => SceneState>(() => state);
    let scale = 1;
    const getScale = vi.fn<() => number>(() => scale);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const manager = createRasterCacheManager({ getContainer, getState, getScale });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600); // round 1: caches at bucket 1
    expect(c1.cacheAsTexture).toHaveBeenLastCalledWith({ resolution: 1, antialias: true });
    vi.advanceTimersByTime(600); // round 2: converges, no change, timer stops
    c1.cacheAsTexture.mockClear();

    // Zoom in past the resolution bucket boundary (bucket 1 -> 4 at scale 3).
    scale = 3;
    manager.onViewportChange();
    vi.advanceTimersByTime(600); // uncaches immediately on the bucket mismatch
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false);
    c1.cacheAsTexture.mockClear();

    // f1's subtree has been quiet the whole time (only the bucket changed) —
    // the very next round re-caches it at the new resolution.
    vi.advanceTimersByTime(600);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 4, antialias: true });
  });

  // Regression (Task: fit_content sizing gate): a fit_content top-level
  // frame's rendered size is the *live* Yoga-computed intrinsic size, never
  // written back to nodesById's width/height — the fits-gate would read
  // stale stored dimensions while cacheAsTexture rasterizes the live bounds.
  // Excluded from caching eligibility entirely.
  it("never caches a fit_content top-level frame", () => {
    const c1 = makeContainer();
    const fitContentFrame = {
      type: "frame",
      width: 1440,
      height: 900,
      layout: { autoLayout: true },
      sizing: { widthMode: "fit_content" },
    } as unknown as SceneState["nodesById"][string];
    const state = makeState(["f1"], { nodesById: { f1: fitContentFrame } });
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const manager = createRasterCacheManager({ getContainer, getState, getScale });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  // Regression (Task: topFrameOf dead-id gap): an id absent from nodesById
  // (already removed from the scene) must not throw, and must not touch an
  // unrelated frame's cache — the removed id's own top ancestor is gone
  // along with it, so there's nothing to mark dirty for it.
  it("a removed id in the mutation set does not throw and does not uncache an unrelated frame", () => {
    const c1 = makeContainer();
    const state = makeState(["f1"]);
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const manager = createRasterCacheManager({ getContainer, getState, getScale });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600 + QUIET_MS); // caches f1
    expect(c1.cacheAsTexture).toHaveBeenLastCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();

    expect(() => manager.onDirectContainerMutation(["removed-node"], state)).not.toThrow();
    // f1 is untouched: "removed-node" has no nodesById entry, so it resolves
    // to no top frame at all, not (incorrectly) to f1.
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
  });

  // Bug 1a (field report): a frame with culled/hidden descendants must never
  // be cached — doing so bakes the currently-hidden content into the
  // texture, which then shows up as permanently-missing layers once panning
  // reveals that content again (culling itself never evicts caches).
  it("never caches a frame whose hasCulledContent dep reports true", () => {
    const c1 = makeContainer();
    const state = makeState(["f1"]);
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const hasCulledContent = vi.fn(() => true);
    const manager = createRasterCacheManager({ getContainer, getState, getScale, hasCulledContent });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).not.toHaveBeenCalled();
    expect(hasCulledContent).toHaveBeenCalledWith("f1", state);
  });

  it("evicts a frame that was cached before hasCulledContent started reporting true", () => {
    const c1 = makeContainer();
    const state = makeState(["f1"]);
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    let culled = false;
    const manager = createRasterCacheManager({
      getContainer,
      getState,
      getScale,
      hasCulledContent: () => culled,
    });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).toHaveBeenLastCalledWith({ resolution: 1, antialias: true });
    c1.cacheAsTexture.mockClear();

    culled = true;
    manager.onViewportChange(); // schedules a decision round without a new mutation
    vi.advanceTimersByTime(600);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false);
  });

  // Bug 2 (field report): the resolution bucket must derive from effective
  // scale (CSS scale * devicePixelRatio) — a HiDPI display must not cache at
  // the CSS-scale-only bucket.
  it("caches at the dpr-adjusted resolution bucket when getPixelRatio is provided", () => {
    const c1 = makeContainer();
    const state = makeState(["f1"]);
    const getState = vi.fn<() => SceneState>(() => state);
    const getScale = vi.fn<() => number>(() => 1);
    const getContainer = vi.fn((id: string) => (id === "f1" ? c1 : null));
    const getPixelRatio = vi.fn(() => 2);
    const manager = createRasterCacheManager({ getContainer, getState, getScale, getPixelRatio });

    manager.onFlushStart(diffFor(["f1"]), state);
    vi.advanceTimersByTime(600 + QUIET_MS + 600);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 2, antialias: true });
  });

  it("cachedFrameIds() reflects the live cached set", () => {
    const c1 = makeContainer();
    const c2 = makeContainer();
    const { manager } = setup({ f1: c1, f2: c2 });

    expect(manager.cachedFrameIds()).toEqual([]);
    manager.onFlushStart(diffFor(["f1", "f2"]), makeState(["f1", "f2"]));
    vi.advanceTimersByTime(600 + QUIET_MS);
    expect(manager.cachedFrameIds().sort()).toEqual(["f1", "f2"]);

    manager.onDirectContainerMutation(["f1"], makeState(["f1", "f2"]));
    expect(manager.cachedFrameIds()).toEqual(["f2"]);
  });
});
