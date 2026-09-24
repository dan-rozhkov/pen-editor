/**
 * Regression: an image fill whose texture finishes loading AFTER its top-level
 * frame was re-cached (`cacheAsTexture`) must evict that cache before the
 * Sprite is attached.
 *
 * Field report: an agent swapped 16 broken image-fill URLs on a large "Reference
 * Board" for working (CORS-enabled) ones. The URL-change flush evicted the
 * board's raster cache, but the slow remote loads took longer than the cache's
 * quiet window (QUIET_MS + decision cadence), so the board was re-cached
 * without the images. `withCachedTexture`'s async `onReady` then attached the
 * Sprites outside any scene flush, with no raster-cache notification — and Pixi
 * never re-renders a cached render group on its own (adding a child doesn't set
 * `textureNeedsUpdate`), so the board kept rendering its pre-load texture
 * forever. Freshly created frames with the same URLs looked fine because by
 * then the textures were cached and `onReady` ran synchronously inside the
 * flush.
 */
import { Assets, Container, type Texture } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTexture } from "@/pixi/renderers/imageFillHelpers";
import {
  resolveOwningNodeId,
  setAsyncContainerMutationHandler,
  type AsyncMutationContainer,
} from "@/pixi/renderers/asyncContainerMutation";
import { createRasterCacheManager, type CacheableContainer } from "../rasterCacheManager";
import { QUIET_MS } from "../rasterCache";
import type { SceneState } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDragStore } from "@/store/dragStore";
import { useEditorModeStore } from "@/store/editorModeStore";

type CacheAsTextureFn = CacheableContainer["cacheAsTexture"];

/** Board "F" (top-level frame) containing rect "R". */
function boardState(): SceneState {
  return {
    nodesById: {
      F: { id: "F", type: "frame", width: 1368, height: 2340 },
      R: { id: "R", type: "rect", width: 300, height: 300 },
    },
    parentById: { F: null, R: "F" },
    childrenById: { F: ["R"] },
    rootIds: ["F"],
  } as unknown as SceneState;
}

let urlCounter = 0;
/** Unique per test — imageFillHelpers' texture cache is module-global. */
const freshUrl = () => `https://wsrv.example.test/?url=img-${++urlCounter}.jpg`;

describe("async image-fill load vs. raster cache", () => {
  beforeEach(() => {
    useSelectionStore.setState({ selectedIds: [], editingNodeId: null });
    useDragStore.setState({ isDragging: false });
    useEditorModeStore.setState({ mode: "edit" });
  });

  afterEach(() => {
    setAsyncContainerMutationHandler(null);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("evicts the cached top-level frame before the late-loading sprite is attached", async () => {
    vi.useFakeTimers();
    const state = boardState();

    // Real Pixi containers (no renderer needed) for the label walk; a mock
    // cacheable surface for the manager, so no WebGL is involved.
    const boardContainer = new Container({ label: "F" });
    const rectContainer = new Container({ label: "R" });
    boardContainer.addChild(rectContainer);
    const registry = new Map<string, Container>([
      ["F", boardContainer],
      ["R", rectContainer],
    ]);

    const events: string[] = [];
    const boardCache = {
      cacheAsTexture: vi.fn<CacheAsTextureFn>((v) => {
        events.push(v === false ? "uncache" : "cache");
      }),
    };
    const manager = createRasterCacheManager({
      getContainer: (id) => (id === "F" ? boardCache : null),
      getState: () => state,
      getScale: () => 1,
    });

    // Same wiring as createPixiSync installs.
    setAsyncContainerMutationHandler((container) => {
      const id = resolveOwningNodeId(container, (label, c) => registry.get(label) === c);
      if (id) manager.onDirectContainerMutation([id], state);
    });

    // 1. The fill-URL change flush: evicts nothing yet, marks F dirty, and the
    //    renderer kicks off a slow remote load.
    manager.onFlushStart({ changedIds: new Set(["R"]), addedIds: [], removedIds: [], updatedIds: ["R"] }, state);
    let resolveLoad!: (t: Texture) => void;
    vi.spyOn(Assets, "load").mockReturnValue(new Promise<Texture>((r) => { resolveLoad = r; }) as never);
    const onReady = vi.fn(() => events.push("sprite-attached"));
    withTexture(freshUrl(), 300, 300, rectContainer, onReady);

    // 2. The load outlives the quiet window → the board is re-cached WITHOUT
    //    the image.
    vi.advanceTimersByTime(QUIET_MS + 1000);
    expect(manager.cachedFrameIds()).toEqual(["F"]);
    expect(events).toEqual(["cache"]);

    // 3. The texture finally arrives, outside any flush.
    const texture = { width: 10, height: 10 } as Texture;
    resolveLoad(texture);
    await vi.waitFor(() => expect(onReady).toHaveBeenCalledWith(texture));

    // The cache must be dropped BEFORE the sprite lands (same ordering rule
    // as onFlushStart), otherwise the stale texture is what gets drawn.
    expect(events).toEqual(["cache", "uncache", "sprite-attached"]);
    expect(manager.cachedFrameIds()).toEqual([]);

    // …and once quiet again, the board is re-cached — now with the image.
    vi.advanceTimersByTime(QUIET_MS + 1000);
    expect(manager.cachedFrameIds()).toEqual(["F"]);
    expect(events.at(-1)).toBe("cache");
    manager.dispose();
  });

  it("notifies for every container queued behind the same in-flight URL", async () => {
    const notified: AsyncMutationContainer[] = [];
    setAsyncContainerMutationHandler((c) => notified.push(c));

    let resolveLoad!: (t: Texture) => void;
    vi.spyOn(Assets, "load").mockReturnValue(new Promise<Texture>((r) => { resolveLoad = r; }) as never);

    const url = freshUrl();
    const a = new Container({ label: "A" });
    const b = new Container({ label: "B" });
    const onReadyA = vi.fn();
    const onReadyB = vi.fn(() => {
      // The queued caller's notification must also precede its mutation.
      expect(notified).toContain(b);
    });
    withTexture(url, 100, 100, a, onReadyA);
    withTexture(url, 100, 100, b, onReadyB);
    expect(notified).toEqual([]); // nothing mutated yet

    resolveLoad({ width: 1, height: 1 } as Texture);
    await vi.waitFor(() => expect(onReadyB).toHaveBeenCalled());
    expect(onReadyA).toHaveBeenCalled();
    expect(notified).toEqual([a, b]);
  });

  it("does not notify for a synchronous cache hit (that runs inside the flush, which already evicted)", async () => {
    const texture = { width: 1, height: 1 } as Texture;
    vi.spyOn(Assets, "load").mockResolvedValue(texture as never);
    const url = freshUrl();
    const first = vi.fn();
    withTexture(url, 100, 100, new Container(), first);
    await vi.waitFor(() => expect(first).toHaveBeenCalled());

    const notified: AsyncMutationContainer[] = [];
    setAsyncContainerMutationHandler((c) => notified.push(c));
    const second = vi.fn();
    withTexture(url, 100, 100, new Container(), second);
    expect(second).toHaveBeenCalledWith(texture);
    expect(notified).toEqual([]);
  });

  it("does not notify or attach when the container was destroyed while loading", async () => {
    const notified: AsyncMutationContainer[] = [];
    setAsyncContainerMutationHandler((c) => notified.push(c));
    let resolveLoad!: (t: Texture) => void;
    vi.spyOn(Assets, "load").mockReturnValue(new Promise<Texture>((r) => { resolveLoad = r; }) as never);

    const container = new Container();
    const onReady = vi.fn();
    const url = freshUrl();
    withTexture(url, 100, 100, container, onReady);
    container.destroy();
    resolveLoad({ width: 1, height: 1 } as Texture);
    // Let the load's .then run.
    await vi.waitFor(() => expect(Assets.load).toHaveBeenCalledWith(url));
    await Promise.resolve();
    await Promise.resolve();
    expect(onReady).not.toHaveBeenCalled();
    expect(notified).toEqual([]);
  });
});

describe("resolveOwningNodeId", () => {
  it("walks up past internal children to the nearest registered node container", () => {
    const board = new Container({ label: "F" });
    const rect = new Container({ label: "R" });
    const internal = new Container({ label: "image-fill" });
    board.addChild(rect);
    rect.addChild(internal);
    const registry = new Map<string, Container>([["F", board], ["R", rect]]);
    const isRegistered = (id: string, c: AsyncMutationContainer) => registry.get(id) === c;

    expect(resolveOwningNodeId(internal, isRegistered)).toBe("R");
    expect(resolveOwningNodeId(rect, isRegistered)).toBe("R");
    // A container whose label matches an id but isn't the registered one
    // (stale, from before a rebuild) doesn't count.
    const stale = new Container({ label: "R" });
    expect(resolveOwningNodeId(stale, isRegistered)).toBeNull();
  });
});
