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
 * `requestAnimationFrame` never fires in a hidden (backgrounded) tab — same
 * gotcha as `getScreenshot.ts` (see its longer comment) and
 * `src/lib/h2dCapture/captureEmbed.ts`'s capture iframe. Skip the rAF
 * entirely when `document.hidden`, and otherwise race it against a short
 * timeout so a hidden/backgrounded tab still settles instead of hanging.
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
    // See getScreenshot.ts: an embed sized fill_container/fit_content stores
    // a 0-placeholder width/height on the raw flat node (FIR-59-style gap) —
    // resolve the real, rendered size before handing it to
    // captureEmbedScreenshot, or its `!node.width || !node.height` guard
    // rejects a node that actually renders fine.
    const effectiveSize = getNodeEffectiveSize(
      useSceneStore.getState().getNodes(),
      nodeId,
      useLayoutStore.getState().calculateLayoutForFrame,
    );
    const embedNode: EmbedNode = effectiveSize
      ? { ...(node as EmbedNode), width: effectiveSize.width, height: effectiveSize.height }
      : (node as EmbedNode);
    const imageData = await captureEmbedScreenshot(embedNode, undefined, nodeId);
    return imageData ? await downscaleImageDataUrl(imageData) : null;
  }

  if (!useCanvasRefStore.getState().pixiRefs) return null;

  try {
    // Same in-flight-image-fill race as `get_screenshot` (see FIR-71 note and
    // longer comment in getScreenshot.ts): settle pixiSync's own pending scene
    // flush FIRST (that's where a just-applied fill's load actually gets
    // registered), THEN wait for pending image loads, THEN one more bounded
    // frame wait so the newly-attached sprites are in the frame extracted
    // below.
    //
    // This capture backs selection previews (a UI nicety, not an agent tool),
    // and the registry is document-global (shared with pattern tiles/video
    // thumbnails elsewhere in the doc) — so use a much shorter timeout than
    // `get_screenshot`'s default to bound how long a preview can stall the UI
    // waiting on unrelated images.
    requestCanvasRender();
    await boundedFrameWait();
    await waitForPendingImageFills(1500);
    requestCanvasRender();
    await boundedFrameWait();

    // Re-resolve AFTER all the awaits above — pixiSync may have fullRebuilt
    // (outline-mode toggle, font load, undo/redo) in that window, destroying
    // and recreating every container, or the node may have been deleted.
    const pixiRefs = useCanvasRefStore.getState().pixiRefs;
    if (!pixiRefs) return null;
    const target = findPixiChild(pixiRefs.sceneRoot, nodeId);
    if (!target) return null;

    const raw = await pixiRefs.app.renderer.extract.base64(target);
    // extract.base64 may or may not include the data URI prefix depending on
    // the PixiJS version — normalize either way (mirrors useComponentThumbnails).
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    return await downscaleImageDataUrl(dataUrl);
  } catch {
    return null;
  }
}
