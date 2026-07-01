import { getNodeContainer } from "@/pixi/pixiSync";
import { useCanvasRefStore } from "@/store/canvasRefStore";

/**
 * Rasterize a scene node's current Pixi rendering to a PNG data URL, for use as
 * the `image` input of an image-filter shader. Returns null when Pixi isn't ready
 * or the node has no container yet. Not unit-tested (requires WebGL).
 */
export async function extractNodeImage(nodeId: string): Promise<string | null> {
  const app = useCanvasRefStore.getState().pixiRefs?.app;
  const container = getNodeContainer(nodeId);
  if (!app || !container) return null;
  try {
    return await app.renderer.extract.base64({ target: container });
  } catch {
    return null;
  }
}
