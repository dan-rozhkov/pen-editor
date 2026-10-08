import type { FlatSceneNode } from "../types/scene";
import { computeBoundNumberPatches } from "../lib/variables/numberBindings";
import { useSceneStore } from "./sceneStore";
import { peekDirty } from "./sceneStore/dirtyTracking";
import { useVariableStore } from "./variableStore";
import { useThemeStore } from "./themeStore";

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
 * same way pixiSync does. A variable / theme change visits only the bound ids.
 * Idempotent: a pass that finds nothing to change writes nothing, and the sync's
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

  const apply = (ids: Iterable<string>): void => {
    const scene = useSceneStore.getState();
    const { variables, collections } = useVariableStore.getState();
    const patches = computeBoundNumberPatches(
      scene.nodesById,
      scene.parentById,
      ids,
      variables,
      collections,
      useThemeStore.getState().activeTheme,
    );
    if (Object.keys(patches).length === 0) return;
    applying = true;
    try {
      scene.applyBoundNumberPatches(patches);
    } finally {
      applying = false;
    }
  };

  rebuild();
  apply(boundIds);

  const unsubScene = useSceneStore.subscribe((state, prev) => {
    if (applying || state.nodesById === prev.nodesById) return;
    const dirty = peekDirty();
    if (!dirty.complete) {
      rebuild();
      apply(boundIds);
      return;
    }
    const touched: string[] = [];
    let themeScopeChanged = false;
    for (const id of dirty.ids) {
      const node = state.nodesById[id];
      if (node === prev.nodesById[id]) continue;
      if (isBound(node)) {
        boundIds.add(id);
        touched.push(id);
      } else {
        boundIds.delete(id);
      }
      // A frame's themeOverride changes the mode of every descendant.
      if (node?.type === "frame" && node.themeOverride !== (prev.nodesById[id] as typeof node | undefined)?.themeOverride) {
        themeScopeChanged = true;
      }
    }
    if (themeScopeChanged) apply(boundIds);
    else if (touched.length > 0) apply(touched);
  });

  const unsubVariables = useVariableStore.subscribe((state, prev) => {
    if (state.variables === prev.variables && state.collections === prev.collections) return;
    if (boundIds.size > 0) apply(boundIds);
  });

  const unsubTheme = useThemeStore.subscribe((state, prev) => {
    if (state.activeTheme === prev.activeTheme) return;
    if (boundIds.size > 0) apply(boundIds);
  });

  return () => {
    unsubScene();
    unsubVariables();
    unsubTheme();
  };
}
