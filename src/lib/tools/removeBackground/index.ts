import type { ToolHandler } from "@/lib/toolRegistry";
import { useSceneStore } from "@/store/sceneStore";
import { getFills, clearLegacyFillProps } from "@/utils/fillUtils";
import type { ImagePaint, Paint } from "@/types/scene";

/** The topmost visible image paint in the stack, if any — mirrors
 * `getPrimarySolidPaint`'s "topmost wins" rule but for image paints. */
function topmostImagePaint(fills: Paint[]): ImagePaint | undefined {
  for (let i = fills.length - 1; i >= 0; i--) {
    const paint = fills[i];
    if (paint.type === "image" && paint.visible !== false && paint.image.url) {
      return paint;
    }
  }
  return undefined;
}

export const removeBackgroundTool: ToolHandler = async (args) => {
  const nodeId = args.nodeId as string;
  const node = useSceneStore.getState().nodesById[nodeId];
  if (!node) {
    return JSON.stringify({ error: `Node ${nodeId} not found` });
  }

  const fills = getFills(node);
  const imagePaint = topmostImagePaint(fills);
  if (!imagePaint) {
    return JSON.stringify({
      error: `Node ${nodeId} has no image fill to remove the background from`,
    });
  }

  try {
    // Lazy-loaded ML pipeline: onnxruntime-web + model weights are only
    // fetched here, on first actual use — `toolRegistry.ts` (and therefore
    // this module) is imported eagerly at app start, so a top-level import
    // here would defeat the lazy-load requirement. Behind a small interface
    // so tests can mock it instead of exercising real WASM inference.
    const { removeBackground, blobToDataUrl } = await import(
      "@/lib/backgroundRemoval"
    );
    const resultBlob = await removeBackground(imagePaint.image.url);
    const dataUrl = await blobToDataUrl(resultBlob);
    const nextFills = fills.map((paint) =>
      paint.id === imagePaint.id
        ? { ...paint, image: { ...(paint as ImagePaint).image, url: dataUrl } }
        : paint,
    );
    useSceneStore.getState().updateNode(nodeId, {
      fills: nextFills,
      ...clearLegacyFillProps(),
    });
    return JSON.stringify({ success: true, nodeId });
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
};
