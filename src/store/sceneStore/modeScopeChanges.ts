import type { FlatSceneNode } from "@/types/scene";
import { getFrameModeOverrides, modeOverridesEqual } from "@/lib/variables/modeContext";
import { peekDirty, peekSetCoverage } from "./dirtyTracking";

interface SceneSlice {
  nodesById: Record<string, FlatSceneNode>;
  parentById: Record<string, string | null | undefined>;
}

export interface ModeScopeChanges {
  /** Ids whose parent link differs (inserted, removed or reparented). */
  movedIds: string[];
  /** Ids whose own mode picks differ (a frame's `modeOverrides` / `themeOverride`). */
  overrideChangedIds: string[];
  /** The dirty channel is incomplete (an unmarked mutation): the caller must treat everything as changed. */
  full: boolean;
}

/**
 * What a scene mutation did to mode SCOPES: which nodes changed their effective
 * mode context for themselves or their descendants. The one shared detector for
 * every subscriber that needs it (number-binding sync, embed mode keys), so they
 * cannot drift apart.
 *
 * Overrides are compared on BOTH the previous and the next node regardless of
 * type: `getFrameModeOverrides` reads as "no overrides" for a non-frame, so a
 * node that stopped being a frame (or became one) counts like any other change.
 * Relies on the dirty channel (`peekDirty`), like its callers.
 */
export function collectModeScopeChanges(
  state: SceneSlice,
  prev: SceneSlice,
  options: { perSet?: boolean } = {},
): ModeScopeChanges {
  const dirty = peekDirty();
  const coverage = peekSetCoverage();
  // Default: any unmarked mutation since the last pixiSync flush forces `full`
  // (for callers that keep derived caches across sets). `perSet`: only THIS
  // set matters (the caller keeps no cross-set cache), and a structural hint
  // declared by the mutator covers an otherwise unmarked set.
  const full = options.perSet ? coverage.unmarked && coverage.structural === null : !dirty.complete;
  if (full) return { movedIds: [], overrideChangedIds: [], full: true };
  const parentsChanged = state.parentById !== prev.parentById;
  const movedIds: string[] = [];
  const overrideChangedIds: string[] = [];
  const ids = new Set<string>(dirty.ids);
  if (options.perSet && coverage.structural) for (const id of coverage.structural) ids.add(id);
  for (const id of ids) {
    if (parentsChanged && state.parentById[id] !== prev.parentById[id]) movedIds.push(id);
    const node = state.nodesById[id];
    const before = prev.nodesById[id];
    if (node === before) continue;
    if (!modeOverridesEqual(getFrameModeOverrides(node), getFrameModeOverrides(before))) overrideChangedIds.push(id);
  }
  return { movedIds, overrideChangedIds, full: false };
}
