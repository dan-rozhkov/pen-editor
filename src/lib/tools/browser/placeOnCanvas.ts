import { useSceneStore } from "@/store/sceneStore";
import type { SceneNode } from "@/types/scene";
import { computeEmptySpace } from "../findEmptySpace";
import { runSerialized } from "@/lib/toolCallQueue";

/**
 * Shared by browse_screenshot (`placeOnCanvas`) and browse_capture: label
 * building and the serialized "pick a spot, add one node" block.
 */
export const FALLBACK_SIZE = { width: 1280, height: 800 };
const MAX_NAME_TITLE = 60;

export function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function isPositive(n: unknown): n is number {
  return isFiniteNumber(n) && n > 0;
}

/** `${prefix} — <page title, else hostname, else "browser">` (title capped). */
export function pageNodeName(page: Record<string, unknown>, prefix: string): string {
  let label = typeof page.title === "string" ? page.title.trim() : "";
  if (!label && typeof page.url === "string") {
    try {
      label = new URL(page.url).hostname;
    } catch {
      label = "";
    }
  }
  if (!label) label = "browser";
  if (label.length > MAX_NAME_TITLE) label = `${label.slice(0, MAX_NAME_TITLE - 1)}…`;
  return `${prefix} — ${label}`;
}

/**
 * Queued so the read of the scene (for the position) and the addNode are not
 * interleaved with a serialized writer's snapshot-and-commit. `x`/`y` apply
 * only as a pair, else the node goes right of existing root content. If
 * `signal` is already aborted when the task runs, nothing is added and
 * `undefined` comes back.
 */
export function placeNodeOnCanvas<T extends SceneNode>(
  x: unknown,
  y: unknown,
  size: { width: number; height: number },
  build: (pos: { x: number; y: number }) => T,
  signal?: AbortSignal
): Promise<{ id: string; x: number; y: number } | undefined> {
  return runSerialized(async () => {
    if (signal?.aborted) return undefined;
    const spot =
      isFiniteNumber(x) && isFiniteNumber(y)
        ? { x, y }
        : computeEmptySpace(useSceneStore.getState(), size);
    // computeEmptySpace only errors for a missing `nodeId` anchor, never passed here.
    const pos = spot as { x: number; y: number };
    const node = build(pos);
    useSceneStore.getState().addNode(node);
    return { id: node.id, x: pos.x, y: pos.y };
  });
}
