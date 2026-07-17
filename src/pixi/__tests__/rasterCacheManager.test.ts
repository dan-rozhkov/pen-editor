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

function makeContainer(): CacheableContainer & { cacheAsTexture: ReturnType<typeof vi.fn> } {
  return { cacheAsTexture: vi.fn() };
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
    // `framePixelSize` is at-current-zoom (width * scale — see rasterCache.ts's
    // `// at current zoom` doc), and the fit check then multiplies by the
    // resolution bucket on top of that — so a frame must be small enough
    // to still fit once *both* factors apply at scale 3 / bucket 4.
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
    manager.onViewportChange(scale);
    vi.advanceTimersByTime(600); // uncaches immediately on the bucket mismatch
    expect(c1.cacheAsTexture).toHaveBeenCalledWith(false);
    c1.cacheAsTexture.mockClear();

    // f1's subtree has been quiet the whole time (only the bucket changed) —
    // the very next round re-caches it at the new resolution.
    vi.advanceTimersByTime(600);
    expect(c1.cacheAsTexture).toHaveBeenCalledWith({ resolution: 4, antialias: true });
  });
});
