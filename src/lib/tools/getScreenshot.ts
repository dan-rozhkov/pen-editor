import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findPixiChild } from "@/utils/pixiUtils";
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
  if (!nodesById[nodeId]) {
    return JSON.stringify({ error: `Node not found: ${nodeId}` });
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
        return JSON.stringify({ imageData });
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
