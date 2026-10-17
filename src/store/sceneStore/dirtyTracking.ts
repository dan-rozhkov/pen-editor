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
