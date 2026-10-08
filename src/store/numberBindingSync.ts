import type { FlatSceneNode } from "../types/scene";
import { computeBoundNumberPatches } from "../lib/variables/numberBindings";
import { useSceneStore } from "./sceneStore";
import { peekDirty } from "./sceneStore/dirtyTracking";
import { useVariableStore } from "./variableStore";
import { useThemeStore } from "./themeStore";
import { getFrameModeOverrides, modeOverridesEqual } from "../lib/variables/modeContext";

/**
 * Keeps the literal fields of number-bound nodes (`node.numberBindings`) equal to
 * their variable's resolved value (T1.5).
 *
 * Everything goes through the normal store flush: patches are ordinary node
 * updates (`applyBoundNumberPatches`: dirty ids marked inside the updater,
 * no history), so pixiSync diffs them, the layout engine recomputes, and the
 * raster cache evicts in `onFlushStart`. Nothing here touches Pixi containers,
 * hence the raster-cache "direct mutation" invariant is not in play.
 *
 * Cost model: a set of bound ids is maintained incrementally from the dirty
 * channel (`peekDirty`); an unmarked mutation falls back to one full scan, the
 * same way pixiSync does. A variable / mode-context change (the document-level context or a frame's `modeOverrides`) visits only the bound ids.
 * Subscriber-triggered passes run in a microtask (coalesced), never nested in the
 * notifying `setState`. Idempotent: a pass that finds nothing to change writes nothing, and the sync's
 * own write is ignored, so there is no subscribe loop.
 */
export function startNumberBindingSync(): () => void {
  const boundIds = new Set<string>();
  let applying = false;

  const isBound = (n: FlatSceneNode | undefined): boolean =>
    n?.numberBindings != null && Object.keys(n.numberBindings).length > 0;

  const rebuild = (): void => {
    boundIds.clear();
    const { nodesById } = useSceneStore.getState();
    for (const id in nodesById) if (isBound(nodesById[id])) boundIds.add(id);
  };

  const applyNow = (ids: Iterable<string>): void => {
    const scene = useSceneStore.getState();
    const { variables, collections } = useVariableStore.getState();
    const patches = computeBoundNumberPatches(
      scene.nodesById,
      scene.parentById,
      ids,
      variables,
      collections,
      useThemeStore.getState().modeContext,
    );
    if (Object.keys(patches).length === 0) return;
    applying = true;
    try {
      scene.applyBoundNumberPatches(patches);
    } finally {
      applying = false;
    }
  };

  // Subscriber-triggered work is deferred to a microtask: calling setState from
  // inside a subscriber nests a second update in the middle of the first one's
  // notification loop, so later subscribers (pixiSync, the layout store) would
  // see the patched state before the state that caused it. Triggers that land
  // before the microtask runs coalesce into one pass over the union of ids.
  let stopped = false;
  let scheduled = false;
  let pendingAll = false;
  const pendingIds = new Set<string>();

  const flushPending = (): void => {
    scheduled = false;
    if (stopped) return;
    const all = pendingAll;
    const ids = [...pendingIds];
    pendingAll = false;
    pendingIds.clear();
    applyNow(all ? boundIds : ids);
  };

  const schedule = (ids: Iterable<string> | "all"): void => {
    if (ids === "all") pendingAll = true;
    else for (const id of ids) pendingIds.add(id);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(flushPending);
  };

  /** Bound ids at or below any of `roots` (children walked via `childrenById`). */
  const boundUnder = (roots: Iterable<string>, childrenById: Record<string, string[]>): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const stack = [...roots];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      if (boundIds.has(id)) out.push(id);
      const kids = childrenById[id];
      if (kids) for (const k of kids) stack.push(k);
    }
    return out;
  };

  rebuild();
  applyNow(boundIds);

  const unsubScene = useSceneStore.subscribe((state, prev) => {
    const nodesChanged = state.nodesById !== prev.nodesById;
    const parentsChanged = state.parentById !== prev.parentById;
    if (applying || (!nodesChanged && !parentsChanged)) return;
    const dirty = peekDirty();
    if (!dirty.complete) {
      rebuild();
      schedule("all");
      return;
    }
    const touched: string[] = [];
    const moved: string[] = [];
    let themeScopeChanged = false;
    for (const id of dirty.ids) {
      // A reparent changes the effective modes of the node and its subtree even
      // though `nodesById` is untouched (moveNode only edits the parent links).
      if (parentsChanged && state.parentById[id] !== prev.parentById[id]) moved.push(id);
      const node = state.nodesById[id];
      if (node === prev.nodesById[id]) continue;
      if (isBound(node)) {
        boundIds.add(id);
        touched.push(id);
      } else {
        boundIds.delete(id);
      }
      // A frame's mode picks change the mode of every descendant.
      if (
        node?.type === "frame" &&
        !modeOverridesEqual(
          getFrameModeOverrides(node),
          getFrameModeOverrides(prev.nodesById[id]),
        )
      ) {
        themeScopeChanged = true;
      }
    }
    if (themeScopeChanged) schedule("all");
    else {
      if (touched.length > 0) schedule(touched);
      if (moved.length > 0) schedule(boundUnder(moved, state.childrenById));
    }
  });

  const unsubVariables = useVariableStore.subscribe((state, prev) => {
    if (state.variables === prev.variables && state.collections === prev.collections) return;
    if (boundIds.size > 0) schedule("all");
  });

  const unsubTheme = useThemeStore.subscribe((state, prev) => {
    if (state.modeContext === prev.modeContext) return;
    if (boundIds.size > 0) schedule("all");
  });

  return () => {
    stopped = true;
    unsubScene();
    unsubVariables();
    unsubTheme();
  };
}
