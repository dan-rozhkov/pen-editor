import { Container, Text } from "pixi.js";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useHoverStore } from "@/store/hoverStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useEditorModeStore } from "@/store/editorModeStore";
import { getViewportBounds } from "@/utils/viewportUtils";
import type { FlatFrameNode, FlatSceneNode } from "@/types/scene";
import { truncateLabelToWidth } from "@/pixi/frameLabelUtils";
import {
  FRAME_NAME_STYLE_COMPONENT,
  FRAME_NAME_STYLE_NORMAL,
  FRAME_NAME_STYLE_SELECTED,
  LABEL_COLOR_COMPONENT,
  LABEL_COLOR_NORMAL,
  LABEL_COLOR_SELECTED,
  LABEL_FONT_SIZE,
  LABEL_OFFSET_Y,
} from "./constants";

// Viewport-cull margin in world units
const FRAME_NAME_CULL_MARGIN = 100;

/**
 * A frame-name renderer owns its own Text object pool. The pool MUST be
 * instance-scoped (not module-global): if two selection overlays coexist —
 * e.g. a StrictMode double-mount or an overlapping remount — a shared pool
 * lets `recycleFrameNames` call `container.removeChild` on the wrong overlay's
 * container (a no-op), leaving the previous label visible while a new one is
 * added on top → duplicated frame labels. Same hazard the spacing pool guards
 * against (see `cleanupSpacingPool` in drawHover.ts).
 */
export interface FrameNameRenderer {
  redraw(frameNamesContainer: Container): void;
  cleanup(): void;
}

export function createFrameNameRenderer(): FrameNameRenderer {
  // Object pool for Text labels (same pattern as OverlayRenderer measure labels)
  const frameNamePool: Text[] = [];
  const activeFrameNames: Text[] = [];

  function recycleFrameNames(container: Container): void {
    while (activeFrameNames.length > 0) {
      const text = activeFrameNames.pop();
      if (!text) break;
      container.removeChild(text);
      frameNamePool.push(text);
    }
  }

  function getPooledText(): Text {
    const pooled = frameNamePool.pop();
    if (pooled) return pooled;
    return new Text({ text: "", style: FRAME_NAME_STYLE_NORMAL });
  }

  /** Destroy all pooled Text objects. Called from selectionOverlay cleanup. */
  function cleanup(): void {
    for (const text of frameNamePool) {
      text.destroy();
    }
    for (const text of activeFrameNames) {
      if (!text.destroyed) text.destroy();
    }
    frameNamePool.length = 0;
    activeFrameNames.length = 0;
  }

  function redraw(frameNamesContainer: Container): void {
    recycleFrameNames(frameNamesContainer);

    // Play/Present mode is read-only fullscreen presentation — no editor
    // chrome (selection outlines/handles are already dropped by clearing
    // selection on enterPresent; frame name labels aren't tied to selection,
    // so they need their own explicit check here).
    if (useEditorModeStore.getState().mode === "present") return;

    const state = useSceneStore.getState();
    const { selectedIds, editingNodeId, editingMode } = useSelectionStore.getState();
    const isDevMode = useDevModeStore.getState().active;
    const { hoveredNodeId } = useHoverStore.getState();
    const { scale, x, y } = useViewportStore.getState();

    // Compute viewport bounds for culling off-screen frame labels
    const vpBounds = getViewportBounds(scale, x, y, window.innerWidth, window.innerHeight);

    const selectedSet = new Set(selectedIds);

    for (const rootId of state.rootIds) {
      const node = state.nodesById[rootId];
      if (
        !node ||
        !(node.type === "frame" || node.type === "group" || node.type === "embed") ||
        node.visible === false ||
        node.enabled === false
      ) {
        continue;
      }

      if (editingNodeId === rootId && editingMode === "name") continue;

      // Viewport culling: skip frames entirely outside the viewport
      const nodeRight = node.x + node.width;
      const nodeBottom = node.y + node.height;
      if (
        nodeRight < vpBounds.minX - FRAME_NAME_CULL_MARGIN ||
        node.x > vpBounds.maxX + FRAME_NAME_CULL_MARGIN ||
        nodeBottom < vpBounds.minY - FRAME_NAME_CULL_MARGIN ||
        node.y > vpBounds.maxY + FRAME_NAME_CULL_MARGIN
      ) {
        continue;
      }

      const flatNode = node as FlatSceneNode;

      const isSelected = selectedSet.has(rootId);
      // A selected frame in Dev mode has a dedicated blue badge rendered by
      // drawSelection, so omit the regular name to prevent a duplicate label.
      if (isDevMode && isSelected) continue;
      const isHovered = hoveredNodeId === rootId;
      const isComponentNode =
        node.type === "frame" && (node as FlatFrameNode).reusable;
      const labelColor = isComponentNode
        ? LABEL_COLOR_COMPONENT
        : isSelected || isHovered
          ? LABEL_COLOR_SELECTED
          : LABEL_COLOR_NORMAL;

      const defaultName =
        node.type === "group" ? "Group" : node.type === "embed" ? "Embed" : "Frame";
      const fullName = flatNode.name || defaultName;

      const worldOffsetY = (LABEL_FONT_SIZE + LABEL_OFFSET_Y) / scale;

      const style =
        labelColor === LABEL_COLOR_COMPONENT
          ? FRAME_NAME_STYLE_COMPONENT
          : labelColor === LABEL_COLOR_SELECTED
            ? FRAME_NAME_STYLE_SELECTED
            : FRAME_NAME_STYLE_NORMAL;
      const maxLabelWidthPx = Math.max(0, node.width * scale);
      const displayName = truncateLabelToWidth(fullName, maxLabelWidthPx, style);
      if (!displayName) continue;

      const text = getPooledText();
      text.text = displayName;
      text.style = style;
      text.position.set(node.x, node.y - worldOffsetY);
      text.scale.set(1 / scale);

      frameNamesContainer.addChild(text);
      activeFrameNames.push(text);
    }
  }

  return { redraw, cleanup };
}
