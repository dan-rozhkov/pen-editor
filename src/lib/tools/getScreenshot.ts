import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findPixiChild } from "@/utils/pixiUtils";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { downscaleImageDataUrl } from "./screenshotDownscale";
import { waitForPendingImageFills } from "@/pixi/renderers/pendingImageLoads";
import { requestCanvasRender } from "@/pixi/renderScheduler";
import type { EmbedNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

/**
 * Wait for one rendered frame, or `timeoutMs` — whichever comes first.
 *
 * `requestAnimationFrame` never fires in a hidden (backgrounded) tab, and
 * `get_screenshot` is exactly the tool a background MCP/desktop bridge
 * session drives from a hidden tab (same gotcha as
 * `src/lib/h2dCapture/captureEmbed.ts`'s capture iframe) — an unbounded
 * `await new Promise(requestAnimationFrame)` would hang the tool call
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

export const getScreenshot: ToolHandler = async (args) => {
  let nodeId = args.nodeId as string | undefined;

  if (!nodeId) {
    const { selectedIds } = useSelectionStore.getState();
    if (selectedIds.length === 0) {
      return JSON.stringify({ error: "nodeId is required (no node is selected)." });
    }
    if (selectedIds.length > 1) {
      return JSON.stringify({ error: "nodeId is required when multiple nodes are selected." });
    }
    nodeId = selectedIds[0];
  }

  const { nodesById } = useSceneStore.getState();
  const node = nodesById[nodeId];
  if (!node) {
    return JSON.stringify({ error: `Node not found: ${nodeId}` });
  }

  // Embeds render as a live Shadow-DOM overlay above the PixiJS canvas (see
  // EmbedLayer.tsx), not as PixiJS scene content — their PixiJS container is
  // deliberately empty (embedRenderer.ts), so extracting pixels from PixiJS
  // below would always return a blank image regardless of whether the
  // embed's own content (including any external images) actually rendered.
  // See FIR-56.
  if (node.type === "embed") {
    // FIR-59-style gap: an embed sized fill_container/fit_content stores 0 as
    // a creation-time placeholder in the flat node (batchDesign/nodeMapper.ts)
    // — the raw `node` here would look 0×0 even though it renders at its real
    // resolved size on screen. Resolve the effective size the same way tool
    // reads already do (serializeUtils.ts) so the screenshot uses the real
    // rendered dimensions instead of tripping the htmlContent/CORS guard in
    // captureEmbedScreenshot for a node that's actually fine.
    const effectiveSize = getNodeEffectiveSize(
      useSceneStore.getState().getNodes(),
      nodeId,
      useLayoutStore.getState().calculateLayoutForFrame,
    );
    const embedNode: EmbedNode = effectiveSize
      ? { ...(node as EmbedNode), width: effectiveSize.width, height: effectiveSize.height }
      : (node as EmbedNode);
    const imageData = await captureEmbedScreenshot(embedNode, undefined, nodeId);
    if (imageData) {
      return JSON.stringify({ imageData: await downscaleImageDataUrl(imageData) });
    }
    return JSON.stringify({
      error: `Embed "${nodeId}" could not be rendered to an image (its HTML may be empty, or contain a cross-origin image served without CORS headers).`,
    });
  }

  if (!useCanvasRefStore.getState().pixiRefs) {
    return JSON.stringify({ error: "No canvas renderer available" });
  }

  try {
    // A just-generated image applied as a fill (e.g. by `set_fill`/
    // `set_image`) loads its Sprite asynchronously — see
    // imageFillHelpers.ts's `withTexture`/`onReady` — so extracting
    // immediately can capture the container before that Sprite is attached
    // (FIR-71). But `applyImageFill` itself only runs inside pixiSync's own
    // rAF-deferred scene flush (`pixiSync.ts`'s `scheduleSceneUpdate`) — if
    // `set_image` and `get_screenshot` land in the same tick (two tool calls
    // in one streamed model step), that flush hasn't run yet, the fill
    // hasn't been registered, and `waitForPendingImageFills()` would see an
    // empty registry and return immediately. So: settle the pending flush
    // FIRST (a bounded frame wait lets pixiSync's already-scheduled rAF
    // fire), THEN wait for whatever image loads that flush just registered,
    // THEN one more bounded frame wait so the newly-attached sprites are
    // actually in the frame `extract.base64` reads from.
    requestCanvasRender();
    await boundedFrameWait();
    await waitForPendingImageFills();
    requestCanvasRender();
    await boundedFrameWait();

    // Re-resolve the Pixi refs and target container AFTER all the awaits
    // above — a wait that can last seconds gives `pixiSync` room to
    // `fullRebuild` (outline-mode toggle, `document.fonts` "loadingdone",
    // undo/redo), which destroys and recreates every container, or the node
    // may simply have been deleted in the meantime. Resolving before the
    // awaits would risk extracting from (or crashing on) a stale/destroyed
    // container.
    const freshRefs = useCanvasRefStore.getState().pixiRefs;
    if (!freshRefs) {
      return JSON.stringify({ error: "No canvas renderer available" });
    }
    const target = findPixiChild(freshRefs.sceneRoot, nodeId);
    if (!target) {
      return JSON.stringify({ error: `Node "${nodeId}" not found in PixiJS scene` });
    }

    // Pixi's extract.base64 already returns a full data URL; older
    // renderers returned bare base64, so only add the prefix when missing.
    const dataUrl = await freshRefs.app.renderer.extract.base64(target);
    const imageData = dataUrl.startsWith("data:")
      ? dataUrl
      : `data:image/png;base64,${dataUrl}`;
    return JSON.stringify({ imageData: await downscaleImageDataUrl(imageData) });
  } catch (e) {
    return JSON.stringify({
      error: `PixiJS screenshot failed: ${e instanceof Error ? e.message : "unknown error"}`,
    });
  }
};
