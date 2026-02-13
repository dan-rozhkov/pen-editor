import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore } from "@/store/sceneStore";
import type { Container } from "pixi.js";
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

  // Try Konva first
  const { stageRef } = useCanvasRefStore.getState();
  if (stageRef) {
    const konvaNode = stageRef.findOne(`#${nodeId}`);
    if (konvaNode) {
      try {
        const dataUrl = konvaNode.toDataURL({ pixelRatio: 2 });
        return JSON.stringify({ imageData: dataUrl });
      } catch (e) {
        return JSON.stringify({
          error: `Screenshot failed: ${e instanceof Error ? e.message : "unknown error"}`,
        });
      }
    }
    return JSON.stringify({ error: `Node "${nodeId}" not found in Konva stage` });
  }

  // Try PixiJS
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

/**
 * Recursively find a PixiJS container by its label (node ID).
 */
function findPixiChild(parent: Container, label: string): Container | null {
  if (parent.label === label) return parent;
  for (const child of parent.children) {
    const found = findPixiChild(child as Container, label);
    if (found) return found;
  }
  return null;
}
