import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { findPixiChild } from "@/utils/pixiUtils";
import { captureEmbedScreenshot } from "@/lib/embedScreenshot";
import type { EmbedNode } from "@/types/scene";

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
  const node = nodesById[nodeId];
  if (!node) return null;

  // Embeds render as a live Shadow-DOM overlay above the PixiJS canvas, with
  // an intentionally empty PixiJS container (see embedRenderer.ts and
  // getScreenshot.ts) — extract their preview from the HTML content directly
  // instead of returning a blank image. See FIR-56.
  if (node.type === "embed") {
    return captureEmbedScreenshot(node as EmbedNode);
  }

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
