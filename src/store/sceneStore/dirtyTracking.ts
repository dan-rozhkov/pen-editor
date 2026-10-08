/**
 * Transient channel telling pixiSync which node ids a scene mutation touched,
 * so its diff can skip the O(N) full-key scan. Any setState not preceded by
 * markNodesDirty poisons the current batch => pixiSync falls back to the full
 * scan. Correctness never depends on mutators remembering to mark.
 */
const pending = new Set<string>();
let complete = true;
let armed = false;

/**
 * When marking a batch that includes newly-added nodes forming a subtree,
 * `ids` must be listed parent-before-child: pixiSync's `createAndAttachNode`
 * drops a child whose parent container isn't registered yet. Currently no
 * mutator does subtree adds via this channel — structural adds rely on the
 * full-scan fallback.
 */
export function markNodesDirty(ids: Iterable<string>): void {
  for (const id of ids) pending.add(id);
  armed = true;
}

export function noteSceneSetState(): void {
  if (!armed) complete = false;
  armed = false;
}

export function consumeDirty(): { ids: Set<string>; complete: boolean } {
  const out = { ids: new Set(pending), complete };
  pending.clear();
  complete = true;
  armed = false;
  return out;
}

/**
 * Non-consuming view of the dirty channel for other store subscribers (the
 * number-binding sync). `ids` is a superset of what the latest mutation touched
 * (it accumulates until pixiSync's flush consumes it); when `complete` is false
 * some mutation since the last flush was unmarked and the caller must full-scan.
 * Relies on `noteSceneSetState` having run first (it is subscribed in
 * sceneStore/index.ts, before any later subscriber).
 */
export function peekDirty(): { ids: ReadonlySet<string>; complete: boolean } {
  return { ids: pending, complete };
}
