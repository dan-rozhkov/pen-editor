import { create } from "zustand";
import { useSceneStore } from "@/store/sceneStore";
import { materializeLayoutRefs } from "@/utils/layoutRefUtils";
import {
  calculateFrameLayout,
  applyLayoutToChildren,
} from "../utils/yogaLayout";
import type { FrameNode, SceneNode } from "../types/scene";

interface LayoutState {
  isYogaInitialized: boolean;
  initializeYoga: () => void;
  calculateLayoutForFrame: (frame: FrameNode) => SceneNode[];
}

// Layout result cache. Tree node objects are reference-stable between scene
// mutations (see store/sceneStore/helpers/treeCache.ts), so frame identity is
// a safe cache key as long as the flat maps haven't changed underneath it.
// WeakMap (not Map) so ad-hoc frame objects (e.g. flatToTreeFrame in
// syncHelpers.ts) don't accumulate — they simply miss the cache, recompute,
// and get collected.
let layoutCacheNodesById: unknown = null;
let layoutCacheChildrenById: unknown = null;
let layoutCache = new WeakMap<FrameNode, SceneNode[]>();

// Layout results also depend on text measurement, which changes when fonts
// finish loading WITHOUT changing nodesById (pixiSync's rebuildFromCurrentState
// reuses the same store maps on font events — see pixiSync.ts). Invalidate the
// cache on font load so we don't serve pre-font-load layouts forever. The store
// is a module-level singleton that lives for the app's lifetime, so the listener
// is intentionally never removed. (Guard mirrors pixiSync.ts.)
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.addEventListener("loadingdone", () => {
    layoutCacheNodesById = null; // forces full reset on next call
  });
}

export const useLayoutStore = create<LayoutState>(() => ({
  isYogaInitialized: true,

  initializeYoga: () => {
    // No-op: pure TypeScript layout engine is always ready
  },

  calculateLayoutForFrame: (frame: FrameNode): SceneNode[] => {
    if (!frame.layout?.autoLayout) {
      return frame.children;
    }

    const { nodesById, childrenById } = useSceneStore.getState();

    // Reset the cache whenever the flat maps change identity (any scene
    // mutation) — this keeps the cache exactly as fresh as the tree cache.
    if (
      nodesById !== layoutCacheNodesById ||
      childrenById !== layoutCacheChildrenById
    ) {
      layoutCacheNodesById = nodesById;
      layoutCacheChildrenById = childrenById;
      layoutCache = new WeakMap<FrameNode, SceneNode[]>();
    }

    const cached = layoutCache.get(frame);
    if (cached) {
      return cached;
    }

    const layoutFrame = materializeLayoutRefs(frame, nodesById, childrenById);
    const layoutResults = calculateFrameLayout(layoutFrame);

    if (layoutResults.length === 0) {
      const result = frame.children;
      layoutCache.set(frame, result);
      return result;
    }

    // Apply layout results to children (including width/height for non-fixed sizing)
    const result = applyLayoutToChildren(frame.children, layoutResults);
    layoutCache.set(frame, result);
    return result;
  },
}));
