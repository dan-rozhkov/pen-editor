import { useSceneStore } from "@/store/sceneStore";
import { useThemeStore } from "@/store/themeStore";
import { peekDirty } from "@/store/sceneStore/dirtyTracking";
import { getEffectiveModeContextForNode } from "@/utils/nodeThemeUtils";
import { getFrameModeOverrides, modeContextKey, modeOverridesEqual } from "@/lib/variables/modeContext";

/**
 * One shared subscriber for "did this embed's effective mode context change?".
 *
 * Every `EmbedHost` used to subscribe to the scene store itself and walk its
 * ancestors on every `nodesById` / `parentById` change: O(embeds x depth) per
 * mutation, including a drag's per-frame position writes. Here a single
 * module-level scene subscription decides whether anything mode-relevant
 * happened (a frame's overrides changed, or a node was reparented/removed, or
 * a mutation was unmarked), and only then recomputes the registered embeds'
 * keys, notifying exactly those whose key changed. A position-only edit of an
 * unrelated node recomputes nothing.
 */
interface Entry {
  key: string;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
let teardown: (() => void) | null = null;
let recomputes = 0;

function keyFor(nodeId: string): string {
  recomputes++;
  return modeContextKey(getEffectiveModeContextForNode(nodeId));
}

function recomputeAll(): void {
  for (const [nodeId, entry] of entries) {
    const key = keyFor(nodeId);
    if (key === entry.key) continue;
    entry.key = key;
    for (const listener of [...entry.listeners]) listener();
  }
}

function install(): void {
  const unsubDoc = useThemeStore.subscribe((state, prev) => {
    if (state.modeContext !== prev.modeContext) recomputeAll();
  });
  const unsubScene = useSceneStore.subscribe((state, prev) => {
    if (entries.size === 0) return;
    const nodesChanged = state.nodesById !== prev.nodesById;
    const parentsChanged = state.parentById !== prev.parentById;
    if (!nodesChanged && !parentsChanged) return;
    const dirty = peekDirty();
    // An unmarked mutation could have touched anything: recompute to be safe.
    if (!dirty.complete) return recomputeAll();
    for (const id of dirty.ids) {
      if (parentsChanged && state.parentById[id] !== prev.parentById[id]) return recomputeAll();
      const node = state.nodesById[id];
      const before = prev.nodesById[id];
      if (node === before) continue;
      if (node?.type !== "frame" && before?.type !== "frame") continue;
      if (!modeOverridesEqual(getFrameModeOverrides(node), getFrameModeOverrides(before))) return recomputeAll();
    }
  });
  teardown = () => {
    unsubDoc();
    unsubScene();
  };
}

/**
 * Calls `onChange` whenever `nodeId`'s effective mode context (document context
 * plus ancestors' overrides) changes. Returns the unsubscribe function.
 */
export function subscribeEmbedModeKey(nodeId: string, onChange: () => void): () => void {
  let entry = entries.get(nodeId);
  if (!entry) {
    entry = { key: keyFor(nodeId), listeners: new Set() };
    entries.set(nodeId, entry);
  }
  entry.listeners.add(onChange);
  if (!teardown) install();
  return () => {
    const current = entries.get(nodeId);
    if (!current) return;
    current.listeners.delete(onChange);
    if (current.listeners.size === 0) entries.delete(nodeId);
    if (entries.size === 0 && teardown) {
      teardown();
      teardown = null;
    }
  };
}

/** Test hook: how many per-embed key computations have run (module lifetime). */
export function getEmbedModeRecomputeCount(): number {
  return recomputes;
}
