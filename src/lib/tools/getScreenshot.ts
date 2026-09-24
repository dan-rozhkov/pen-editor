import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import { extractPixiNodeDataUrl, resolveEmbedForCapture } from "@/lib/captureNodeScreenshot";
import { findHiddenSelfOrAncestor } from "@/utils/nodeUtils";
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

  const { nodesById, parentById } = useSceneStore.getState();
  const node = nodesById[nodeId];
  if (!node) {
    return JSON.stringify({ error: `Node not found: ${nodeId}` });
  }

  // A hidden node — `visible === false` on itself, or on any ancestor (a
  // hidden frame/group takes its whole subtree off screen), or `enabled ===
  // false` on itself/an ancestor (how a `ref` instance's overrides hide a
  // component-internal node, see `enabled?: boolean` in `types/scene.ts`) —
  // is never drawn on the real canvas. Refuse BEFORE attempting either
  // capture path: for the embed path, `captureEmbedScreenshot` renders raw
  // `htmlContent` with no visibility check of its own, so a hidden embed
  // would otherwise leak its content as an image even though the canvas
  // never draws it — the same class of leak `read_embed_html` was fixed for
  // (see `withheldOnSharedView` in webmcp/schemas.ts); for the PixiJS path
  // this also avoids wasting a render on what would only ever come back
  // blank. `findHiddenSelfOrAncestor` is the same predicate `EmbedLayer.tsx`
  // uses to decide what to mount, so this refusal matches what the canvas
  // actually draws.
  const hidden = findHiddenSelfOrAncestor(nodesById, parentById, nodeId);
  if (hidden) {
    const who = hidden.isSelf
      ? `Node "${nodeId}"`
      : `An ancestor of node "${nodeId}" (node "${hidden.nodeId}")`;
    return JSON.stringify({
      error: `${who} is hidden (${hidden.reason}: false), so there is nothing to capture. Make it visible and try again.`,
    });
  }

  // Embeds render as a live Shadow-DOM overlay above the PixiJS canvas (see
  // EmbedLayer.tsx), not as PixiJS scene content — their PixiJS container is
  // deliberately empty (embedRenderer.ts), so extracting pixels from PixiJS
  // below would always return a blank image regardless of whether the
  // embed's own content (including any external images) actually rendered.
  // See FIR-56.
  if (node.type === "embed") {
    const imageData = await captureEmbedScreenshot(
      resolveEmbedForCapture(node as EmbedNode, nodeId),
      undefined,
      nodeId,
    );
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
    // See `extractPixiNodeDataUrl` for why it waits on pending image fills
    // (FIR-71) and re-resolves the container after the waits.
    const result = await extractPixiNodeDataUrl(nodeId);
    if (!result.ok) {
      return JSON.stringify({
        error: result.reason === "no-renderer"
          ? "No canvas renderer available"
          : `Node "${nodeId}" not found in PixiJS scene`,
      });
    }
    return JSON.stringify({ imageData: await downscaleImageDataUrl(result.dataUrl) });
  } catch (e) {
    return JSON.stringify({
      error: `PixiJS screenshot failed: ${e instanceof Error ? e.message : "unknown error"}`,
    });
  }
};
