import type { EmbedNode } from "@/types/scene";
import { isValidComponentKey } from "@/lib/embedComponents";
import { createSnapshot } from "@/store/sceneStore/helpers/history";
import { useSceneStore } from "@/store/sceneStore";
import { useHistoryStore, withHistoryBatch } from "@/store/historyStore";
import { listAllEmbeds } from "@/store/componentOps";

export function toolError(message: string): string {
  return JSON.stringify({ error: message });
}

export const KEY_RULE = 'key must match /^[a-z][a-z0-9-]{0,39}$/ and not be "slot"';

export function readKey(args: Record<string, unknown>): string | null {
  return isValidComponentKey(args.key) ? args.key : null;
}

/** Find an embed on any page. */
export function findEmbed(
  nodeId: unknown,
): { node: EmbedNode; pageId: string; isActive: boolean } | null {
  if (typeof nodeId !== "string" || !nodeId) return null;
  return listAllEmbeds().find((e) => e.node.id === nodeId) ?? null;
}

/**
 * Run `fn` as ONE undo step on the active page: snapshot once up front, then
 * batch so the individual store writes inside do not add their own entries.
 * With `record: false` (the active page is not touched) `fn` just runs.
 */
export function inOneHistoryStep<T>(record: boolean, fn: () => T): T {
  if (!record) return fn();
  useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
  return withHistoryBatch(fn);
}
