import type { ToolExecutionContext, ToolHandler } from "../../toolRegistry";
import { createImagePaint, clearLegacyFillProps } from "@/utils/fillUtils";
import { generateId, type RectNode } from "@/types/scene";
import { loadImageSize } from "@/components/canvas/imageImport";
import {
  executeBrowseTool,
  type ExecuteBrowseToolOptions,
} from "@sideform/browser-agent/agent/execute";
import { getBrowserBridge } from "./bridge";
import { FALLBACK_SIZE, isPositive, pageNodeName, placeNodeOnCanvas } from "./placeOnCanvas";
import { peBase, safeParseObject } from "./shared";

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
 * The capture itself is the package's (`executeBrowseTool`); the placement is
 * the `afterScreenshot` step below.
 */
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

const placeOnCanvasStep = async (
  { raw, result, args, bridgeArgs, capture }: Parameters<NonNullable<ExecuteBrowseToolOptions["afterScreenshot"]>>[0],
  context: ToolExecutionContext | undefined
): Promise<string> => {
  if ("error" in result) return raw;
  if (typeof result.imageData !== "string") {
    return JSON.stringify({ ...result, placeError: "The capture returned no image data." });
  }

  // Labels must not end up in the design: re-capture without annotation.
  let shot: Record<string, unknown> = result;
  if (bridgeArgs.annotate === true) {
    const plain = safeParseObject(await capture({ annotate: false }));
    if (typeof plain.imageData !== "string" || "error" in plain) {
      const reason = typeof plain.error === "string" ? plain.error : "no image data";
      return JSON.stringify({ ...result, placeError: `Plain capture for the canvas failed: ${reason}` });
    }
    shot = plain;
  }
  const dataUrl = shot.imageData as string;
  const { width, height } = await screenshotSize(shot, dataUrl);
  const name = pageNodeName(shot, "Screenshot");

  // The capture is already in hand: a failed placement (e.g. the canvas tab refused it
  // in the agent panel) is reported next to it instead of throwing the screenshot away.
  let placedAt: { id: string; x: number; y: number } | undefined;
  try {
    placedAt = await placeNodeOnCanvas(
      args.x,
      args.y,
      { width, height },
      (pos) => ({
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
      } as RectNode),
      context?.signal,
      context?.sessionId
    );
  } catch (err) {
    return JSON.stringify({ ...result, placeError: err instanceof Error ? err.message : "Placing the screenshot failed." });
  }
  if (!placedAt) return JSON.stringify({ ...result, placeError: "Placing the screenshot was aborted." });
  const placedRect = { x: placedAt.x, y: placedAt.y, width, height };

  return JSON.stringify({ ...result, placedNodeId: placedAt.id, placedAt: placedRect });
};

export const browseScreenshot: ToolHandler = (args, context) =>
  executeBrowseTool(getBrowserBridge(context?.sessionId, context?.browserSession), "browse_screenshot", args, {
    ...peBase,
    afterScreenshot: (ctx) => placeOnCanvasStep(ctx, context),
  });
