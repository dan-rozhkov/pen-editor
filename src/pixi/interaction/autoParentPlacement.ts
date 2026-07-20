import { useSceneStore } from "@/store/sceneStore";
import { useLayoutStore } from "@/store/layoutStore";
import { useSelectionStore } from "@/store/selectionStore";
import { findTopmostFrameContainingRectWithLayout } from "@/utils/nodeUtils";
import type { SceneNode } from "@/types/scene";

/**
 * Add a freshly-drawn node to the scene, auto-parenting it into the topmost
 * frame whose bounds contain it (or adding it as a root node otherwise), then
 * select it. Shared by the pen and pencil tools' path-commit logic.
 */
export function addDrawnNodeWithAutoParenting(
  node: SceneNode,
  bbox: { x: number; y: number; width: number; height: number },
  id: string,
): void {
  const sceneState = useSceneStore.getState();
  const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
  const targetRect = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  const targetFrame = findTopmostFrameContainingRectWithLayout(
    sceneState.getNodes(),
    targetRect,
    calculateLayoutForFrame,
  );

  if (targetFrame) {
    sceneState.addChildToFrame(targetFrame.frame.id, {
      ...node,
      x: bbox.x - targetFrame.absoluteX,
      y: bbox.y - targetFrame.absoluteY,
    });
  } else {
    sceneState.addNode(node);
  }

  useSelectionStore.getState().select(id);
}
