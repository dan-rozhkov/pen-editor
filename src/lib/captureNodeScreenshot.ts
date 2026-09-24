import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { findPixiChild } from "@/utils/pixiUtils";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { downscaleImageDataUrl } from "@/lib/tools/screenshotDownscale";
import { waitForPendingImageFills } from "@/pixi/renderers/pendingImageLoads";
import { requestCanvasRender } from "@/pixi/renderScheduler";
import type { EmbedNode } from "@/types/scene";

/**
 * Wait for one rendered frame, or `timeoutMs` — whichever comes first.
 *
 * `requestAnimationFrame` never fires in a hidden (backgrounded) tab, and
 * `get_screenshot` is exactly the tool a background MCP/desktop bridge
 * session drives from a hidden tab (same gotcha as
 * `src/lib/h2dCapture/captureEmbed.ts`'s capture iframe) — an unbounded
 * `await new Promise(requestAnimationFrame)` would hang the capture
 * forever whenever the editor tab isn't focused. Skip the rAF entirely when
 * `document.hidden` (nothing will ever paint anyway), and otherwise race it
 * against a short timeout so a tab that becomes hidden mid-wait still
 * settles.
 */
function boundedFrameWait(timeoutMs = 250): Promise<void> {
  if (typeof document !== "undefined" && document.hidden) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const rafId = requestAnimationFrame(settle);
    const timer = setTimeout(() => {
      cancelAnimationFrame(rafId);
      settle();
    }, timeoutMs);
  });
}

/**
 * The embed as it actually renders. FIR-59-style gap: an embed sized
 * fill_container/fit_content stores 0 as a creation-time placeholder in the
 * flat node (batchDesign/nodeMapper.ts) — the raw node would look 0×0 even
 * though it renders at its real resolved size on screen. Resolve the
 * effective size the same way tool reads already do (serializeUtils.ts), or
 * `captureEmbedScreenshot`'s `!node.width || !node.height` guard rejects a
 * node that actually renders fine.
 */
export function resolveEmbedForCapture(node: EmbedNode, nodeId: string): EmbedNode {
  const effectiveSize = getNodeEffectiveSize(
    useSceneStore.getState().getNodes(),
    nodeId,
    useLayoutStore.getState().calculateLayoutForFrame,
  );
  return effectiveSize
    ? { ...node, width: effectiveSize.width, height: effectiveSize.height }
    : node;
}

export type PixiExtractResult =
  | { ok: true; dataUrl: string }
  | { ok: false; reason: "no-renderer" | "not-found" };

/**
 * Extract a scene node from the live PixiJS scene graph as a PNG data URL.
 * Throws if `extract.base64` itself fails; callers decide how to report it.
 *
 * A just-generated image applied as a fill (e.g. by `set_fill`/`set_image`)
 * loads its Sprite asynchronously — see imageFillHelpers.ts's
 * `withTexture`/`onReady` — so extracting immediately can capture the
 * container before that Sprite is attached (FIR-71). But `applyImageFill`
 * itself only runs inside pixiSync's own rAF-deferred scene flush
 * (`pixiSync.ts`'s `scheduleSceneUpdate`) — if `set_image` and
 * `get_screenshot` land in the same tick, that flush hasn't run yet, the fill
 * hasn't been registered, and `waitForPendingImageFills()` would see an empty
 * registry and return immediately. So: settle the pending flush FIRST, THEN
 * wait for whatever image loads that flush just registered, THEN one more
 * bounded frame wait so the newly-attached sprites are actually in the frame
 * `extract.base64` reads from.
 */
export async function extractPixiNodeDataUrl(
  nodeId: string,
  imageWaitTimeoutMs?: number,
): Promise<PixiExtractResult> {
  requestCanvasRender();
  await boundedFrameWait();
  await waitForPendingImageFills(imageWaitTimeoutMs);
  requestCanvasRender();
  await boundedFrameWait();

  // Re-resolve AFTER all the awaits above — a wait that can last seconds
  // gives pixiSync room to fullRebuild (outline-mode toggle, font load,
  // undo/redo), destroying and recreating every container, or the node may
  // have been deleted in the meantime.
  const pixiRefs = useCanvasRefStore.getState().pixiRefs;
  if (!pixiRefs) return { ok: false, reason: "no-renderer" };
  const target = findPixiChild(pixiRefs.sceneRoot, nodeId);
  if (!target) return { ok: false, reason: "not-found" };

  const raw = await pixiRefs.app.renderer.extract.base64(target);
  // extract.base64 may or may not include the data URI prefix depending on
  // the PixiJS version — normalize either way (mirrors useNodeThumbnails).
  const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  return { ok: true, dataUrl };
}

/**
 * Best-effort PNG screenshot of a scene node as a data URL, captured straight
 * from the live PixiJS scene graph. Returns `null` (never throws) when the node
 * is missing, the renderer is unavailable, or extraction fails — callers treat
 * a null as "no preview/context for this node".
 *
 * Shares the same extraction path as the `get_screenshot` tool
 * (`src/lib/tools/getScreenshot.ts`), including the downscale
 * (`screenshotDownscale.ts`) — a selected top-level frame at DPR 2 can
 * extract to several thousand pixels on a side, whose PNG data URL can
 * exceed the backend's data-URL size cap; this variant is for UI context
 * (selection previews attached to chat messages) rather than tool replies.
 */
export async function captureNodeScreenshot(
  nodeId: string,
): Promise<string | null> {
  const { nodesById } = useSceneStore.getState();
  const node = nodesById[nodeId];
  if (!node) return null;

  // Embeds render as a live Shadow-DOM overlay above the PixiJS canvas, with
  // an intentionally empty PixiJS container (see embedRenderer.ts and
  // getScreenshot.ts) — extract their preview from the HTML content directly
  // instead of returning a blank image. See FIR-56.
  if (node.type === "embed") {
    const imageData = await captureEmbedScreenshot(
      resolveEmbedForCapture(node as EmbedNode, nodeId),
      undefined,
      nodeId,
    );
    return imageData ? await downscaleImageDataUrl(imageData) : null;
  }

  if (!useCanvasRefStore.getState().pixiRefs) return null;

  try {
    // This capture backs selection previews (a UI nicety, not an agent tool),
    // and the pending-image registry is document-global (shared with pattern
    // tiles/video thumbnails elsewhere in the doc) — so use a much shorter
    // timeout than `get_screenshot`'s default to bound how long a preview can
    // stall the UI waiting on unrelated images.
    const result = await extractPixiNodeDataUrl(nodeId, 1500);
    return result.ok ? await downscaleImageDataUrl(result.dataUrl) : null;
  } catch {
    return null;
  }
}
