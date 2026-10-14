import type { ToolHandler } from "../../toolRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";
import { generateId, type RectNode } from "@/types/scene";
import { computeEmptySpace } from "../findEmptySpace";
import { runSerialized } from "@/lib/toolCallQueue";
import { loadImageSize } from "@/components/canvas/imageImport";
import { getBrowserBridge } from "./bridge";
import {
  BROWSER_BRIDGE_METHOD_MISSING_ERROR,
  callBrowserBridge,
  safeParseObject,
} from "./shared";

/**
 * browse_screenshot — a viewport capture of the built-in browser tab
 * (docs/superpowers/specs/2026-09-23-full-browser-use-design.md, "Desktop
 * bridge"). Returns `{ imageData: "data:image/jpeg;base64,…", width,
 * height, url, title, snapshotId?, elements? }` — the backend's
 * `toModelOutput` turns `imageData` into an image part the same way
 * `get_screenshot`'s does, so this handler must not touch or re-encode it.
 * `annotate: true` numbers every snapshot element on the image itself
 * (set-of-marks) and returns `snapshotId`/`elements` alongside it for a
 * following index-targeted `browse_act`. Thin forwarder onto
 * `window.penDesktop.browser.screenshot`, same conventions as its browse_*
 * siblings — except this bridge method is new enough that an older desktop
 * build may have `window.penDesktop.browser` but lack `.screenshot`, so
 * that case gets its own, more actionable error instead of the generic
 * "browser not available" one.
 *
 * `placeOnCanvas: true` additionally puts the capture on the design canvas
 * as one `rect` with an image fill (`x`/`y` pick the top-left, else it goes
 * right of existing root content). Those three args are stripped before the
 * bridge call. With `annotate`, the placed image is a second, plain capture
 * so the numbered labels don't end up in the design. `x`/`y` apply only as a
 * pair. The scene write goes through `runSerialized`; the capture does not.
 */
const MAX_NAME_TITLE = 60;
const FALLBACK_SIZE = { width: 1280, height: 800 };

function isFiniteNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isPositive(n: unknown): n is number {
  return isFiniteNumber(n) && n > 0;
}

async function screenshotSize(shot: Record<string, unknown>, dataUrl: string) {
  if (isPositive(shot.width) && isPositive(shot.height)) {
    return { width: shot.width, height: shot.height };
  }
  try {
    const natural = await loadImageSize(dataUrl);
    if (isPositive(natural.width) && isPositive(natural.height)) return natural;
  } catch {
    // fall through
  }
  return FALLBACK_SIZE;
}

function screenshotName(shot: Record<string, unknown>): string {
  let label = typeof shot.title === "string" ? shot.title.trim() : "";
  if (!label && typeof shot.url === "string") {
    try {
      label = new URL(shot.url).hostname;
    } catch {
      label = "";
    }
  }
  if (!label) label = "browser";
  if (label.length > MAX_NAME_TITLE) label = `${label.slice(0, MAX_NAME_TITLE - 1)}…`;
  return `Screenshot — ${label}`;
}

export const browseScreenshot: ToolHandler = async (args, context) => {
  const browser = getBrowserBridge(context?.sessionId);
  const call = browser?.screenshot
    ? (a: Record<string, unknown>) => browser.screenshot!(a)
    : undefined;
  const unavailableMessage =
    browser && !browser.screenshot ? BROWSER_BRIDGE_METHOD_MISSING_ERROR : undefined;

  const { placeOnCanvas, x, y, ...bridgeArgs } = args;
  const raw = await callBrowserBridge(call, bridgeArgs, unavailableMessage);
  if (placeOnCanvas !== true) return raw;

  const result = safeParseObject(raw);
  if ("error" in result) return raw;
  if (typeof result.imageData !== "string") {
    return JSON.stringify({ ...result, placeError: "The capture returned no image data." });
  }

  // Labels must not end up in the design: re-capture without annotation.
  let shot: Record<string, unknown> = result;
  if (bridgeArgs.annotate === true) {
    const plain = safeParseObject(
      await callBrowserBridge(call, { ...bridgeArgs, annotate: false }, unavailableMessage)
    );
    if (typeof plain.imageData !== "string" || "error" in plain) {
      const reason = typeof plain.error === "string" ? plain.error : "no image data";
      return JSON.stringify({ ...result, placeError: `Plain capture for the canvas failed: ${reason}` });
    }
    shot = plain;
  }
  const dataUrl = shot.imageData as string;
  const { width, height } = await screenshotSize(shot, dataUrl);
  const name = screenshotName(shot);

  // Queued so the read of the scene (for the position) and the addNode are
  // not interleaved with a serialized writer's snapshot-and-commit.
  const placedAt = await runSerialized(async () => {
    const spot =
      isFiniteNumber(x) && isFiniteNumber(y)
        ? { x, y }
        : computeEmptySpace(useSceneStore.getState(), { width, height });
    // computeEmptySpace only errors for a missing `nodeId` anchor, which is never passed here.
    const { x: px, y: py } = spot as { x: number; y: number };
    const node = {
      id: generateId(),
      type: "rect",
      name,
      x: px,
      y: py,
      width,
      height,
      cornerRadius: 0,
      fills: [createImagePaint({ url: dataUrl, mode: "fill" })],
      ...clearLegacyFillProps(),
    } as RectNode;
    useSceneStore.getState().addNode(node);
    return { id: node.id, x: px, y: py, width, height };
  });

  const { id, ...rect } = placedAt;
  return JSON.stringify({ ...result, placedNodeId: id, placedAt: rect });
};
