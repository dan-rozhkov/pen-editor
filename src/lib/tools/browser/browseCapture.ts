import type { ToolHandler } from "../../toolRegistry";
import { generateId, type EmbedNode } from "@/types/scene";
import { getBrowserBridge } from "./bridge";
import { FALLBACK_SIZE, isPositive, pageNodeName, placeNodeOnCanvas } from "./placeOnCanvas";
import {
  BROWSER_BRIDGE_METHOD_MISSING_ERROR,
  callBrowserBridge,
  safeParseObject,
} from "./shared";

/**
 * browse_capture — copies the built-in browser page (or one element of it)
 * onto the canvas as ONE editable `embed` node whose `htmlContent` is the
 * page's self-contained HTML (pen-editor-backend docs/specs/
 * 2026-10-15-browse-capture-design.md). `x`/`y` (a pair) pick the top-left,
 * else the node goes right of existing root content; both are stripped before
 * the bridge call. The scene write goes through `runSerialized` (one undo
 * step via `addNode`); the capture itself does not. The model gets back only
 * `{ nodeId, width, height, url, title }` — never the HTML, which can be
 * megabytes. An older desktop build has `browser` but no `.capture`, which
 * gets the actionable "needs a newer version" error.
 */
const ABORTED_ERROR = JSON.stringify({ error: "browse_capture was aborted or timed out; nothing was added." });

export const browseCapture: ToolHandler = async (args, context) => {
  const browser = getBrowserBridge(context?.sessionId);
  const call = browser?.capture ? (a: Record<string, unknown>) => browser.capture!(a) : undefined;
  const unavailableMessage =
    browser && !browser.capture ? BROWSER_BRIDGE_METHOD_MISSING_ERROR : undefined;

  const { x, y, ...bridgeArgs } = args;
  const signal = context?.signal;
  const raw = await callBrowserBridge(call, bridgeArgs, unavailableMessage);
  // A timed-out or stopped call must not place a late node: the model was
  // already told it failed (and may retry), which would duplicate the page.
  if (signal?.aborted) return ABORTED_ERROR;
  const page = safeParseObject(raw);
  if ("error" in page) return raw;
  if (typeof page.html !== "string" || !page.html) {
    return JSON.stringify({ error: "The capture returned no HTML." });
  }

  const html = page.html;
  const size =
    isPositive(page.width) && isPositive(page.height)
      ? { width: page.width, height: page.height }
      : FALLBACK_SIZE;
  const name = pageNodeName(page, "Page");

  const placed = await placeNodeOnCanvas(
    x,
    y,
    size,
    (pos): EmbedNode => ({
      id: generateId(),
      type: "embed",
      name,
      x: pos.x,
      y: pos.y,
      width: size.width,
      height: size.height,
      htmlContent: html,
    }),
    signal
  );
  if (!placed) return ABORTED_ERROR;
  const nodeId = placed.id;

  return JSON.stringify({
    nodeId,
    width: size.width,
    height: size.height,
    url: typeof page.url === "string" ? page.url : "",
    title: typeof page.title === "string" ? page.title : "",
  });
};
