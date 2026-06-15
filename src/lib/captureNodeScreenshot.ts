import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { findPixiChild } from "@/utils/pixiUtils";

/**
 * Best-effort PNG screenshot of a scene node as a data URL, captured straight
 * from the live PixiJS scene graph. Returns `null` (never throws) when the node
 * is missing, the renderer is unavailable, or extraction fails — callers treat
 * a null as "no preview/context for this node".
 *
 * Shares the same extraction path as the `get_screenshot` tool
 * (`src/lib/tools/getScreenshot.ts`); this variant is for UI context (selection
 * previews attached to chat messages) rather than tool replies.
 */
export async function captureNodeScreenshot(
  nodeId: string,
): Promise<string | null> {
  const { nodesById } = useSceneStore.getState();
  if (!nodesById[nodeId]) return null;

  const { pixiRefs } = useCanvasRefStore.getState();
  if (!pixiRefs) return null;

  const target = findPixiChild(pixiRefs.sceneRoot, nodeId);
  if (!target) return null;

  try {
    const raw = await pixiRefs.app.renderer.extract.base64(target);
    // extract.base64 may or may not include the data URI prefix depending on
    // the PixiJS version — normalize either way (mirrors useComponentThumbnails).
    return raw.startsWith("data:") ? raw : `data:image/png;base64,${raw}`;
  } catch {
    return null;
  }
}
