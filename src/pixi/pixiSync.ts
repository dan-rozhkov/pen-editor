import { Container } from "pixi.js";
import { useSceneStore, type SceneState } from "@/store/sceneStore";
import { useDragStore } from "@/store/dragStore";
import { useVariableStore } from "@/store/variableStore";
import { useStyleStore } from "@/store/styleStore";
import { useViewportStore } from "@/store/viewportStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useRenderModeStore } from "@/store/renderModeStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import type { FlatSceneNode } from "@/types/scene";
import { isFlatFrameNode, isRefNode, isConnectorNode } from "@/types/scene";
import { updateNodeContainer } from "./renderers";
import { applySiblingMasks } from "./renderers/maskHelpers";
import { isOutlineRenderMode } from "./renderers/outlineHelpers";
import { isActiveMasker } from "@/lib/masks/maskResolution";
import { requestCanvasRender } from "./renderScheduler";
import {
  type RegistryEntry,
  ComponentIdIndex,
  collectAffectedInstanceIds,
  withAncestorThemes,
  getChildrenHost,
} from "./syncHelpers";
import { createResolutionManager } from "./syncResolution";
import { createNodeTreeManager } from "./syncNodeTree";
import { createConnectorManager } from "./syncConnectors";
import { createAutoLayoutManager } from "./syncAutoLayout";
import { perfStats } from "./perfStats";
import { computeSceneDiffFull, computeSceneDiffDirty } from "./syncDiff";
import { consumeDirty } from "@/store/sceneStore/dirtyTracking";

// Module-level registry accessor for the drag animator
let registryAccessor: ((id: string) => Container | null) | null = null;
let sceneRootAccessor: (() => Container) | null = null;

export function getNodeContainer(id: string): Container | null {
  return registryAccessor?.(id) ?? null;
}

export function getSceneRoot(): Container | null {
  return sceneRootAccessor?.() ?? null;
}

/**
 * Sentinel "previous node" used to force all renderers to re-apply visual
 * properties (fill, stroke, shadow, etc.) without destroying containers.
 * Every property comparison with the real node will show "changed".
 */
const THEME_SENTINEL = Object.freeze({ type: "none" }) as unknown as FlatSceneNode;

/**
 * DEV-only diff safety net (runs the full O(N) scan alongside the dirty-set
 * diff and warns on mismatch). Kept on by default in dev, but can be opted
 * out of via `localStorage.setItem("pen.diffCheck", "off")` so perf probes
 * (which run in dev mode) can measure the shipped diff path uncontaminated.
 */
const diffCheckEnabled = import.meta.env.DEV && localStorage.getItem("pen.diffCheck") !== "off";

/**
 * A node is "variable-dependent" if its rendering can change when a design
 * variable / theme changes:
 * - `ref`: the resolved component subtree may contain bindings anywhere;
 * - `embed`: variables are injected as a CSS block into the HTML;
 * - any node with a `fillBinding` or `strokeBinding`;
 * - any node whose `fills` stack contains a solid paint with a `colorBinding`;
 * - any node whose `fills` stack contains a paint bound to a fill style
 *   (`styleId`) — the style may itself carry a `colorBinding`;
 * - any node with an `effectStyleId`, or an `effects` stack containing a
 *   shadow with a `colorBinding`.
 *
 * NOTE: if a new `*Binding` field is added to scene nodes (see
 * `src/types/scene.ts`), it MUST be added here, or bound nodes will stop
 * live-updating on variable changes.
 */
export function isVariableDependent(node: FlatSceneNode): boolean {
  return (
    node.type === "ref" || // resolved subtree may contain bindings anywhere
    node.type === "embed" || // variables are injected as CSS into the HTML
    node.fillBinding != null ||
    node.strokeBinding != null ||
    node.effectStyleId != null ||
    // Deliberately scans the raw `node.fills` instead of `getFills()`: this
    // runs for every node on registration and must not manufacture a derived
    // legacy paint stack. Legacy-only nodes are covered by the `fillBinding`
    // check above.
    (node.fills != null &&
      node.fills.some((p) => (p.type === "solid" && p.colorBinding != null) || p.styleId != null)) ||
    (node.effects != null &&
      node.effects.some((e) => e.type === "shadow" && e.colorBinding != null))
  );
}

/**
 * Core sync engine: subscribes to Zustand scene store and incrementally updates PixiJS containers.
 * Returns a cleanup function.
 */
export function createPixiSync(sceneRoot: Container): () => void {
  const registry = new Map<string, RegistryEntry>();
  // Nodes whose rendering can change when a design variable / theme changes.
  // Maintained in lockstep with the registry so theme updates only touch them.
  const variableDependentIds = new Set<string>();
  let fontsRebuildRafId: number | null = null;
  let disposed = false;

  // Expose registry and sceneRoot to the drag animator
  registryAccessor = (id) => registry.get(id)?.container ?? null;
  sceneRootAccessor = () => sceneRoot;

  const ctx = { sceneRoot, registry };
  const resolutionMgr = createResolutionManager(ctx);
  const nodeTreeMgr = createNodeTreeManager(
    ctx,
    () => resolutionMgr.getAppliedTextResolution(),
    (id) => resolutionMgr.clearEmbedCache(id),
  );

  // Phase 3: Index for fast componentId → refNodeId lookups
  const componentIndex = new ComponentIdIndex();

  // Connector index + geometry recomputation when connected nodes move/resize.
  const connectorMgr = createConnectorManager();
  const {
    addToConnectorIndex,
    removeFromConnectorIndex,
    buildConnectorIndex,
    updateConnectorsForNodes,
  } = connectorMgr;

  // Viewport culling + auto-layout position application.
  const autoLayoutMgr = createAutoLayoutManager(ctx);
  const { updateCulling, collectDirtyAutoLayoutFrames, applyAutoLayoutPositions } = autoLayoutMgr;

  // ─── Full Rebuild ────────────────────────────────────────────────────

  /**
   * Full rebuild - used on initial load.
   */
  function fullRebuild(state: SceneState): void {
    // Clear existing
    sceneRoot.removeChildren();
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();

    // Build all nodes
    nodeTreeMgr.buildNodeTree(state.rootIds, state.nodesById, state.childrenById, sceneRoot);

    // Phase 3: Rebuild componentId index
    componentIndex.buildFrom(state.nodesById);

    // Rebuild connector index
    buildConnectorIndex(state.nodesById);

    // Rebuild variable-dependency set
    variableDependentIds.clear();
    for (const id of Object.keys(state.nodesById)) {
      const node = state.nodesById[id];
      if (node && isVariableDependent(node)) {
        variableDependentIds.add(id);
      }
    }

    // Phase 6: Rebuild text/ref node tracking
    resolutionMgr.rebuildTracking();

    // Apply auto-layout positions
    applyAutoLayoutPositions(state);
    resolutionMgr.resetResolutions();
    resolutionMgr.applyTextResolution(resolutionMgr.getTargetTextResolution(useViewportStore.getState().scale));
    resolutionMgr.applyEmbedResolution(resolutionMgr.getTargetEmbedResolution(useViewportStore.getState().scale));
    resolutionMgr.applyImageFillTextureResolution(resolutionMgr.getTargetImageFillResolution(useViewportStore.getState().scale));
    nodeTreeMgr.applyTextEditingVisibility();

    // Phase 1: Apply culling after build
    updateCulling();
  }

  // ─── Phase 7: Incremental Theme/Variable Update ──────────────────────

  /**
   * Re-apply colors to all containers without destroying/recreating the tree.
   * Uses THEME_SENTINEL as a fake "previous" node so all property comparisons
   * evaluate as "changed", causing renderers to re-resolve fills/strokes.
   */
  function incrementalThemeUpdate(): void {
    const state = useSceneStore.getState();
    for (const id of variableDependentIds) {
      const entry = registry.get(id);
      if (!entry) continue;
      withAncestorThemes(id, state.parentById, state.nodesById, () => {
        updateNodeContainer(
          entry.container,
          entry.node,
          THEME_SENTINEL,
          state.nodesById,
          state.childrenById,
          true, // skipPosition — positions haven't changed
          entry.node.type === "ref", // forceRebuild only for refs (re-resolve internal colors)
        );
      });
    }
    nodeTreeMgr.applyTextEditingVisibility();
  }

  // ─── Incremental Update (Phases 3 + 4) ──────────────────────────────

  /**
   * Incremental update - only process changed nodes.
   */
  function incrementalUpdate(
    state: SceneState,
    prev: SceneState,
    dirty?: { ids: Set<string>; complete: boolean },
  ): void {
    if (state.nodesById === prev.nodesById && state.rootIds === prev.rootIds && state.childrenById === prev.childrenById) {
      return; // No scene changes
    }

    // Phase 5: dirty-set diff when honest, full O(N) scan otherwise —
    // byte-identical output either way (see syncDiff.ts equivalence tests).
    const diff = dirty?.complete
      ? computeSceneDiffDirty(state, prev, dirty.ids)
      : computeSceneDiffFull(state, prev);

    if (diffCheckEnabled && dirty?.complete) {
      const fullCheck = computeSceneDiffFull(state, prev);
      let mismatch = false;
      for (const id of diff.changedIds) {
        if (!fullCheck.changedIds.has(id)) { mismatch = true; break; }
      }
      if (!mismatch) {
        for (const id of fullCheck.changedIds) {
          if (!diff.changedIds.has(id)) { mismatch = true; break; }
        }
      }
      if (mismatch) {
        console.warn(
          "[pixiSync] dirty-set diff mismatch vs full scan — a mutator likely skipped markNodesDirty",
          { dirty: [...diff.changedIds], full: [...fullCheck.changedIds] },
        );
      }
    }

    const changedIds = diff.changedIds;
    const themeChangedFrameIds: string[] = [];

    // Handle added nodes
    for (const id of diff.addedIds) {
      nodeTreeMgr.createAndAttachNode(id, state);
      // Phase 3 + 6: Update indexes for new nodes
      const node = state.nodesById[id];
      if (node) {
        if (isRefNode(node)) {
          componentIndex.add(id, node.componentId);
        }
        if (isConnectorNode(node)) {
          addToConnectorIndex(id, node);
        }
        if (isVariableDependent(node)) {
          variableDependentIds.add(id);
        }
        resolutionMgr.trackNodeAdded(id, node);
      }
    }

    // Phase 3: Use componentId index for fast instance lookup
    const affectedInstanceIds = collectAffectedInstanceIds(state, prev, changedIds, componentIndex);

    // Handle removed nodes
    for (const id of diff.removedIds) {
      // Phase 3 + 6: Update indexes for removed nodes
      const prevNode = prev.nodesById[id];
      if (prevNode) {
        if (isRefNode(prevNode)) {
          componentIndex.remove(id, prevNode.componentId);
        }
        if (isConnectorNode(prevNode)) {
          removeFromConnectorIndex(id, prevNode);
        }
        variableDependentIds.delete(id);
        resolutionMgr.trackNodeRemoved(id);
      }
      nodeTreeMgr.removeNode(id, prev.childrenById, state.nodesById);
    }

    // Nodes whose isMask flag (or masking-relevant visibility) flipped
    // without a children-order change (that path is covered by
    // reconcileChildren below) — their parent's sibling masking must be
    // re-resolved once all container updates below have run. Root-level
    // nodes (no parentId) have no registry parent entry to key off of, so
    // they're tracked separately via `rootMaskDirty` and re-resolved against
    // `sceneRoot` directly.
    const maskDirtyParentIds = new Set<string>();
    let rootMaskDirty = false;

    // Handle updated nodes (reference equality check)
    for (const id of diff.updatedIds) {
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      if (node && prevNode && node !== prevNode) {
        // A frame's themeOverride recolors its whole subtree — collect it for
        // a targeted THEME_SENTINEL pass below instead of a full scene rebuild.
        if (
          isFlatFrameNode(node) &&
          node.themeOverride !== (isFlatFrameNode(prevNode) ? prevNode.themeOverride : undefined)
        ) {
          themeChangedFrameIds.push(id);
        }
        const entry = registry.get(id);
        if (entry) {
          if (isActiveMasker(node) !== isActiveMasker(prevNode)) {
            const parentId = state.parentById[id];
            if (parentId) {
              maskDirtyParentIds.add(parentId);
            } else {
              rootMaskDirty = true;
            }
          }
          // Check if node is inside auto-layout frame
          const parentId = state.parentById[id];
          const parentNode = parentId ? state.nodesById[parentId] : null;
          const isInAutoLayout = !!parentNode && isFlatFrameNode(parentNode) &&
            parentNode.layout?.autoLayout;

          withAncestorThemes(id, state.parentById, state.nodesById, () => {
            updateNodeContainer(
              entry.container,
              node,
              entry.node,
              state.nodesById,
              state.childrenById,
              isInAutoLayout, // skipPosition for auto-layout children
              false,
            );
          });
          entry.node = node;

          // Re-evaluate variable-dependency since edits can add/remove bindings.
          if (isVariableDependent(node)) {
            variableDependentIds.add(id);
          } else {
            variableDependentIds.delete(id);
          }

          // Phase 3: Update componentId index if ref's componentId changed
          if (isRefNode(node) && isRefNode(prevNode)) {
            const prevCompId = prevNode.componentId;
            const newCompId = node.componentId;
            if (prevCompId !== newCompId) {
              componentIndex.remove(id, prevCompId);
              componentIndex.add(id, newCompId);
            }
          }
        }
      }
    }

    // Rebuild instance render trees when their source component changed,
    // even if the ref node itself is unchanged.
    for (const id of affectedInstanceIds) {
      if (changedIds.has(id)) continue;
      const node = state.nodesById[id];
      const prevNode = prev.nodesById[id];
      const entry = registry.get(id);
      if (!node || !prevNode || !entry || node.type !== "ref" || prevNode.type !== "ref") {
        continue;
      }
      withAncestorThemes(id, state.parentById, state.nodesById, () => {
        updateNodeContainer(
          entry.container,
          node,
          prevNode,
          state.nodesById,
          state.childrenById,
          false,
          true,
        );
      });
      entry.node = node;
      changedIds.add(id);
    }

    // Targeted theme refresh: re-resolve variable-bound colors for descendants
    // of frames whose themeOverride changed. Mirrors incrementalThemeUpdate but
    // limited to the affected subtrees — the frames themselves were already
    // updated with their new node objects above.
    if (themeChangedFrameIds.length > 0) {
      const subtreeIds = new Set<string>();
      const collect = (rootId: string): void => {
        const children = state.childrenById[rootId];
        if (!children) return;
        for (const childId of children) {
          if (subtreeIds.has(childId)) continue;
          subtreeIds.add(childId);
          collect(childId);
        }
      };
      for (const frameId of themeChangedFrameIds) collect(frameId);

      for (const id of subtreeIds) {
        if (changedIds.has(id)) continue; // already updated with its fresh node
        const node = state.nodesById[id];
        if (!node) continue;
        if (!variableDependentIds.has(id) && node.type !== "ref") continue;
        const entry = registry.get(id);
        if (!entry) continue;
        withAncestorThemes(id, state.parentById, state.nodesById, () => {
          updateNodeContainer(
            entry.container,
            entry.node,
            THEME_SENTINEL,
            state.nodesById,
            state.childrenById,
            true, // skipPosition — positions haven't changed
            entry.node.type === "ref", // forceRebuild refs to re-resolve internal colors
          );
        });
      }
      nodeTreeMgr.applyTextEditingVisibility();
    }

    // Update connectors when connected nodes move/resize. Collect the changed
    // non-connector ids and recompute all affected connectors in one batched
    // store write per flush.
    const movedNonConnectorIds: string[] = [];
    for (const id of changedIds) {
      const node = state.nodesById[id];
      if (node && node.type !== "connector") {
        movedNonConnectorIds.push(id);
      }
    }
    if (movedNonConnectorIds.length > 0) {
      updateConnectorsForNodes(movedNonConnectorIds);
    }

    // Handle structural changes (children order, parent changes)
    if (state.childrenById !== prev.childrenById || state.rootIds !== prev.rootIds) {
      nodeTreeMgr.reconcileChildren(state, prev);
      // Any host whose children list changed already had its masking
      // re-resolved inside reconcileChildren — skip it here. Iterate the
      // (typically tiny) dirty set directly rather than every host key in
      // the scene.
      for (const id of maskDirtyParentIds) {
        if (state.childrenById[id] !== prev.childrenById[id]) {
          maskDirtyParentIds.delete(id);
        }
      }
      // Root list order/membership changes are likewise already resolved by
      // reconcileChildren's root-level reconcileChildList call.
      if (state.rootIds !== prev.rootIds) {
        rootMaskDirty = false;
      }
    }

    // Re-resolve sibling masking for any parent whose child's isMask flag
    // toggled in place (no children-order change to trigger reconcileChildren).
    // Skipped in outline mode, which never applies masks (see groupRenderer.ts
    // / frameRenderer.ts's matching guards at build time).
    if (!isOutlineRenderMode()) {
      for (const parentId of maskDirtyParentIds) {
        const parentEntry = registry.get(parentId);
        if (!parentEntry) continue;
        const childrenHost = getChildrenHost(parentEntry.container);
        if (!childrenHost) continue;
        applySiblingMasks(
          state.childrenById[parentId] ?? [],
          state.nodesById,
          (id) => childrenHost.getChildByLabel(id),
          childrenHost,
        );
      }

      // Same re-resolution for a root-level node whose isMask/visibility
      // toggled in place without a rootIds structural change.
      if (rootMaskDirty) {
        applySiblingMasks(
          state.rootIds,
          state.nodesById,
          (id) => sceneRoot.getChildByLabel(id),
          sceneRoot,
        );
      }
    }

    // Reapply only affected auto-layout frame chains.
    const dirtyAutoLayoutFrames = collectDirtyAutoLayoutFrames(
      state,
      changedIds,
    );
    if (dirtyAutoLayoutFrames.size > 0) {
      applyAutoLayoutPositions(state, dirtyAutoLayoutFrames);
    }
    // New text nodes can appear during incremental subtree rebuilds (e.g. instance edits).
    // Re-apply current resolution so they don't stay at the default and look blurry.
    resolutionMgr.refreshTextResolution();
    nodeTreeMgr.applyTextEditingVisibility();

    // Phase 1: Re-apply culling after tree changes.
    // NOTE: this call must stay last (and unconditional) in this function.
    // `applySiblingMasks` above writes `.renderable` on root/child containers
    // (to hide inert maskers), and `updateCulling` also writes `.renderable`
    // for viewport culling — whichever runs last wins for any container both
    // touch. Not currently user-visible (an inert masker is rarely also
    // outside the viewport), but the ordering is fragile: reordering these
    // two, or short-circuiting before this line, can silently resurrect a
    // culled node or re-show an inert masker.
    updateCulling();
  }

  // ─── Subscriptions ───────────────────────────────────────────────────

  let lastScale = useViewportStore.getState().scale;
  let lastX = useViewportStore.getState().x;
  let lastY = useViewportStore.getState().y;

  // Initial resolutions
  resolutionMgr.applyTextResolution(resolutionMgr.getTargetTextResolution(lastScale));
  resolutionMgr.applyEmbedResolution(resolutionMgr.getTargetEmbedResolution(lastScale));
  resolutionMgr.applyImageFillTextureResolution(resolutionMgr.getTargetImageFillResolution(lastScale));

  const unsubViewport = useViewportStore.subscribe((state) => {
    if (state.scale !== lastScale) {
      lastScale = state.scale;
      lastX = state.x;
      lastY = state.y;
      resolutionMgr.scheduleTextResolutionUpdate(state.scale);
      resolutionMgr.scheduleEmbedResolutionUpdate(state.scale);
      resolutionMgr.scheduleImageFillResolutionUpdate(state.scale);
      // Phase 1: Update culling on zoom
      updateCulling();
    } else if (state.x !== lastX || state.y !== lastY) {
      lastX = state.x;
      lastY = state.y;
      resolutionMgr.schedulePanUpgrade();
      // Phase 1: Update culling on pan
      updateCulling();
    }
  });

  // Subscribe to Zustand store
  const initialState = useSceneStore.getState();
  fullRebuild(initialState);

  let prevState = initialState;
  let pendingSceneState: SceneState | null = null;
  let sceneUpdateFrameId: number | null = null;

  const flushSceneUpdate = (): void => {
    sceneUpdateFrameId = null;
    if (!pendingSceneState) return;
    const nextState = pendingSceneState;
    pendingSceneState = null;
    const dirty = consumeDirty();
    perfStats.time("flush", () => {
      incrementalUpdate(nextState, prevState, dirty);
    });
    prevState = nextState;
  };

  const scheduleSceneUpdate = (state: SceneState): void => {
    pendingSceneState = state;
    if (sceneUpdateFrameId != null) return;
    sceneUpdateFrameId = requestAnimationFrame(flushSceneUpdate);
  };

  const clearPendingSceneUpdate = (): void => {
    pendingSceneState = null;
    if (sceneUpdateFrameId != null) {
      cancelAnimationFrame(sceneUpdateFrameId);
      sceneUpdateFrameId = null;
    }
  };

  const unsubScene = useSceneStore.subscribe((state) => {
    scheduleSceneUpdate(state);
  });

  const rebuildFromCurrentState = (): void => {
    clearPendingSceneUpdate();
    consumeDirty(); // discard — a full rebuild resolves everything, no stale ids should leak into the next incremental flush
    fullRebuild(useSceneStore.getState());
    prevState = useSceneStore.getState();
  };

  // Outline mode toggles the visual rules every renderer applies (see
  // `renderers/*.ts`'s `isOutlineRenderMode()` checks) — an incremental
  // update wouldn't revisit unchanged nodes, so every container would keep
  // its previous mode's content until it happened to change for some other
  // reason. A full rebuild re-evaluates every node under the new mode and,
  // by destroying the old containers, also guarantees no fill/shader/blur
  // texture or filter survives the switch (the known "leak on toggle back"
  // failure mode this store's docs warn about).
  const unsubRenderMode = useRenderModeStore.subscribe(() => {
    rebuildFromCurrentState();
  });

  const scheduleRebuildFromFonts = (): void => {
    if (disposed || fontsRebuildRafId != null) return;
    fontsRebuildRafId = requestAnimationFrame(() => {
      fontsRebuildRafId = null;
      rebuildFromCurrentState();
    });
  };

  // RAF-coalesce variable/theme updates: a burst of variable-store mutations
  // (e.g. dragging a color slider) collapses into one theme update per frame.
  // Registered after the scene-update RAF so, when both land in the same frame,
  // the theme flush runs after the scene flush (browsers run RAF callbacks in
  // registration order).
  let themeUpdateFrameId: number | null = null;

  const flushThemeUpdate = (): void => {
    themeUpdateFrameId = null;
    if (disposed) return;
    incrementalThemeUpdate();
  };

  const scheduleThemeUpdate = (): void => {
    if (disposed || themeUpdateFrameId != null) return;
    themeUpdateFrameId = requestAnimationFrame(flushThemeUpdate);
  };

  const clearPendingThemeUpdate = (): void => {
    if (themeUpdateFrameId != null) {
      cancelAnimationFrame(themeUpdateFrameId);
      themeUpdateFrameId = null;
    }
  };

  const unsubVariables = useVariableStore.subscribe(() => {
    scheduleThemeUpdate();
  });

  // Fill/effect style edits (color, gradient, shadow stack, etc.) must
  // re-resolve every referencing node the same way a variable edit does —
  // both `getResolvedRenderableFills`/`getResolvedRenderableEffects` read
  // live from `styleStore`, so a plain theme-update pass picks up the change.
  const unsubStyles = useStyleStore.subscribe(() => {
    scheduleThemeUpdate();
  });

  const unsubSelection = useSelectionStore.subscribe(() => {
    nodeTreeMgr.applyTextEditingVisibility();
  });

  // Play/Present mode/slide changes aren't scene mutations, so nothing else
  // here re-applies visibility for them — this is what actually derives and
  // applies the present-mode hide set (syncNodeTree.ts's present-mode branch
  // of applyTextEditingVisibility) on enter/index-change/exit. No explicit
  // repaint call here: renderScheduler.ts's own `useEditorModeStore.subscribe
  // (markActivity)` already owns scheduling a repaint for this store's
  // changes (`requestCanvasRender` === `invalidate` === `markActivity`).
  const unsubEditorMode = useEditorModeStore.subscribe(() => {
    nodeTreeMgr.applyTextEditingVisibility();
  });

  // The auto-layout drag animator (autoLayoutDragAnimator.ts) mutates
  // containers directly, bypassing the store. A normal drop commits a scene
  // mutation whose flush re-applies layout, but some exits (drop with no
  // insert target, Esc cancel) mutate nothing — re-apply layout for the
  // affected frame chain whenever a drag ends, so container positions always
  // reconcile with the computed layout regardless of how the drag finished.
  const unsubDrag = useDragStore.subscribe((dragState, prevDragState) => {
    if (!prevDragState.isDragging || dragState.isDragging) return;
    const draggedId = prevDragState.draggedNodeId;
    if (!draggedId) return;
    // A drop that committed a scene mutation already scheduled a flush that
    // will re-apply layout for the affected chain — don't relayout it twice.
    if (pendingSceneState !== null) return;
    const sceneState = useSceneStore.getState();
    const dirtyFrames = collectDirtyAutoLayoutFrames(
      sceneState,
      new Set([draggedId]),
    );
    if (dirtyFrames.size > 0) {
      applyAutoLayoutPositions(sceneState, dirtyFrames);
      // Direct container mutation outside a store flush — signal the renderer.
      requestCanvasRender();
    }
  });

  let removeFontsListener: (() => void) | null = null;
  if (typeof document !== "undefined" && "fonts" in document) {
    const fonts = document.fonts;
    fonts.ready.then(() => {
      scheduleRebuildFromFonts();
    });
    const onLoadingDone = () => {
      scheduleRebuildFromFonts();
    };
    fonts.addEventListener("loadingdone", onLoadingDone);
    removeFontsListener = () => {
      fonts.removeEventListener("loadingdone", onLoadingDone);
    };
  }

  return () => {
    disposed = true;
    if (fontsRebuildRafId != null) {
      cancelAnimationFrame(fontsRebuildRafId);
      fontsRebuildRafId = null;
    }
    unsubScene();
    unsubVariables();
    unsubStyles();
    unsubSelection();
    unsubEditorMode();
    unsubDrag();
    unsubViewport();
    unsubRenderMode();
    resolutionMgr.cleanup();
    clearPendingSceneUpdate();
    clearPendingThemeUpdate();
    removeFontsListener?.();
    // Clean up all containers
    for (const entry of registry.values()) {
      entry.container.destroy({ children: true });
    }
    registry.clear();
    variableDependentIds.clear();
    componentIndex.clear();
    connectorMgr.clear();
    sceneRoot.removeChildren();
    registryAccessor = null;
    sceneRootAccessor = null;
  };
}
