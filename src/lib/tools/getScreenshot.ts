import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findPixiChild } from "@/utils/pixiUtils";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import { getNodeEffectiveSize } from "@/utils/nodeUtils";
import { downscaleImageDataUrl } from "./screenshotDownscale";
import type { EmbedNode } from "@/types/scene";
import type { ToolHandler } from "../toolRegistry";

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

  const { pixiRefs } = useCanvasRefStore.getState();
  if (pixiRefs) {
    const { app, sceneRoot } = pixiRefs;
    const target = findPixiChild(sceneRoot, nodeId);
    if (target) {
      try {
        // Pixi's extract.base64 already returns a full data URL; older
        // renderers returned bare base64, so only add the prefix when missing.
        const dataUrl = await app.renderer.extract.base64(target);
        const imageData = dataUrl.startsWith("data:")
          ? dataUrl
          : `data:image/png;base64,${dataUrl}`;
        return JSON.stringify({ imageData: await downscaleImageDataUrl(imageData) });
      } catch (e) {
        return JSON.stringify({
          error: `PixiJS screenshot failed: ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }
    }
    return JSON.stringify({ error: `Node "${nodeId}" not found in PixiJS scene` });
  }

  return JSON.stringify({ error: "No canvas renderer available" });
};
