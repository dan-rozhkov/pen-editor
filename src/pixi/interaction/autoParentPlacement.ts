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
      // Derive the parent-relative position from the node's OWN placement
      // (`node.x/y`), not the caller's hit-test `bbox`. For every existing
      // caller (pencil/pen tools, `draw_vector`) these are identical, so
      // this is a no-op there. But `generate_vector` bakes an intra-SVG
      // offset into `node.x/y` (`scaleAndOffsetNode`'s `minX * fit`, when
      // the artwork's content doesn't start at its own viewBox origin) that
      // `bbox` — the target box used only for the auto-parent hit-test —
      // does not carry. Using `bbox.x/y` here silently discarded that
      // offset, landing the drawing at a different spot depending on
      // whether it fell into this branch or the `addNode` one below.
      x: node.x - targetFrame.absoluteX,
      y: node.y - targetFrame.absoluteY,
    });
  } else {
    sceneState.addNode(node);
  }

  useSelectionStore.getState().select(id);
}
