import { useSceneStore } from "@/store/sceneStore";
import type { SceneNode } from "@/types/scene";
import { computeEmptySpace } from "../findEmptySpace";
import { runSerialized } from "@/lib/toolCallQueue";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";
import { generateId, type RectNode } from "@/types/scene";
import { loadImageSize } from "@/components/canvas/imageImport";

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

/** Local 24-hour `HH:MM:SS`, zero-padded. */
export function localClockTime(at: Date = new Date()): string {
  return [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

/**
 * Where the node is placed when this page has no scene of its own (the agent
 * panel, docs/canvas-link.md): receives the node WITHOUT position and
 * `{x?, y?, size}` (a `build` callback cannot cross the wire) and answers the
 * placed `{id, x, y}`. `undefined` = aborted. Throws with the reason on failure.
 * `sessionId` is the chat the tool runs for (its bound canvas tab gets the node).
 */
export type PlaceNodeRedirect = (
  node: Record<string, unknown>,
  options: { x?: number; y?: number; size: { width: number; height: number } },
  signal?: AbortSignal,
  sessionId?: string
) => Promise<{ id: string; x: number; y: number } | undefined>;

let placeNodeRedirect: PlaceNodeRedirect | null = null;

/** Installs (or with null removes) the redirect. Only the agent panel sets it. */
export function setPlaceNodeRedirect(redirect: PlaceNodeRedirect | null): void {
  placeNodeRedirect = redirect;
}

/**
 * Queued so the read of the scene (for the position) and the addNode are not
 * interleaved with a serialized writer's snapshot-and-commit. `x`/`y` apply
 * only as a pair, else the node goes right of existing root content. If
 * `signal` is already aborted when the task runs, nothing is added and
 * `undefined` comes back. `sessionId` (the calling chat) only matters in the
 * agent panel, where the node goes to that chat's bound canvas tab.
 */
export function placeNodeOnCanvas<T extends SceneNode>(
  x: unknown,
  y: unknown,
  size: { width: number; height: number },
  build: (pos: { x: number; y: number }) => T,
  signal?: AbortSignal,
  sessionId?: string
): Promise<{ id: string; x: number; y: number } | undefined> {
  const redirect = placeNodeRedirect;
  if (redirect) {
    if (signal?.aborted) return Promise.resolve(undefined);
    // Position is the canvas tab's business: build with a dummy spot, strip it.
    const { x: _x, y: _y, ...node } = build({ x: 0, y: 0 });
    void _x;
    void _y;
    const pair = isFiniteNumber(x) && isFiniteNumber(y) ? { x, y } : {};
    return redirect(node, { ...pair, size }, signal, sessionId);
  }
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

/** Size of an image: the `width`/`height` the source reports, else the decoded size, else FALLBACK_SIZE. */
async function imageSize(source: Record<string, unknown>, dataUrl: string) {
  if (isPositive(source.width) && isPositive(source.height)) {
    return { width: source.width, height: source.height };
  }
  try {
    const natural = await loadImageSize(dataUrl);
    if (isPositive(natural.width) && isPositive(natural.height)) return natural;
  } catch {
    // fall through
  }
  return FALLBACK_SIZE;
}

/**
 * Puts one image on the canvas as a `rect` with an image fill (shared by browse_screenshot and trace_frame).
 * `source.width`/`height` give the size when present. Resolves the node's id and rect; `undefined` = aborted.
 * Throws with the reason when the placement fails.
 */
export async function placeImageRect(
  dataUrl: string,
  source: Record<string, unknown>,
  name: string,
  at: { x?: unknown; y?: unknown },
  signal?: AbortSignal,
  sessionId?: string
): Promise<{ id: string; x: number; y: number; width: number; height: number } | undefined> {
  const { width, height } = await imageSize(source, dataUrl);
  const placed = await placeNodeOnCanvas(
    at.x,
    at.y,
    { width, height },
    (pos) =>
      ({
        id: generateId(),
        type: "rect",
        name,
        x: pos.x,
        y: pos.y,
        width,
        height,
        cornerRadius: 0,
        fills: [createImagePaint({ url: dataUrl, mode: "fill" })],
        ...clearLegacyFillProps(),
      }) as RectNode,
    signal,
    sessionId
  );
  return placed && { ...placed, width, height };
}
