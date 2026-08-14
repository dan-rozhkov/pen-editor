import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { findPixiChild } from "@/utils/pixiUtils";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { downscaleImageDataUrl } from "@/lib/tools/screenshotDownscale";
import type { EmbedNode } from "@/types/scene";

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

  const { pixiRefs } = useCanvasRefStore.getState();
  if (!pixiRefs) return null;

  const target = findPixiChild(pixiRefs.sceneRoot, nodeId);
  if (!target) return null;

  try {
    const raw = await pixiRefs.app.renderer.extract.base64(target);
    // extract.base64 may or may not include the data URI prefix depending on
    // the PixiJS version — normalize either way (mirrors useComponentThumbnails).
    const dataUrl = raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
    return await downscaleImageDataUrl(dataUrl);
  } catch {
    return null;
  }
}
