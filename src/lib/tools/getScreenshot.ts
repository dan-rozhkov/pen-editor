import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { findPixiChild } from "@/utils/pixiUtils";
import type { ToolHandler } from "../toolRegistry";

export const getScreenshot: ToolHandler = async (args) => {
  const nodeId = args.nodeId as string | undefined;
  if (!nodeId) {
    return JSON.stringify({ error: "nodeId is required" });
  }

  const { nodesById } = useSceneStore.getState();
  if (!nodesById[nodeId]) {
    return JSON.stringify({ error: `Node not found: ${nodeId}` });
  }

  const { pixiRefs } = useCanvasRefStore.getState();
  if (pixiRefs) {
    const { app, sceneRoot } = pixiRefs;
    const target = findPixiChild(sceneRoot, nodeId);
    if (target) {
      try {
        const dataUrl = await app.renderer.extract.base64(target);
        return JSON.stringify({ imageData: `data:image/png;base64,${dataUrl}` });
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
