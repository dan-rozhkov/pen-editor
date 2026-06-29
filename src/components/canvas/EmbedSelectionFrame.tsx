import { useViewportStore } from "@/store/viewportStore";
import { useSceneStore } from "@/store/sceneStore";
import type { EmbedNode, FlatFrameNode } from "@/types/scene";
import { embedScreenRect } from "./embedLayerGeometry";

const SELECTION_COLOR = "#0d99ff";
const COMPONENT_SELECTION_COLOR = "#8b5cf6";
const HANDLE_SIZE = 8;

interface EmbedSelectionFrameProps {
  node: EmbedNode;
  absoluteX: number;
  absoluteY: number;
}

/** Walk ancestors to detect whether the node lives inside a component/instance. */
function isInComponentContext(nodeId: string): boolean {
  const { nodesById, parentById } = useSceneStore.getState();
  let currentId: string | null = nodeId;
  while (currentId) {
    const node = nodesById[currentId];
    if (
      (node?.type === "frame" && !!(node as FlatFrameNode).reusable) ||
      node?.type === "ref"
    ) {
      return true;
    }
    currentId = parentById[currentId] ?? null;
  }
  return false;
}

/**
 * DOM-rendered selection frame + resize handles for a selected embed node.
 *
 * The Pixi selection overlay lives inside the canvas, which the embed HTML
 * layer (EmbedLayer, z-index 10) covers — so the Pixi outline/handles are
 * hidden behind the embed's content. This mirrors them as a DOM layer above the
 * embeds (z-index 11) so they stay visible. It is purely visual
 * (pointer-events: none); the Pixi transform controller still handles the
 * actual resize since events pass through the inactive embed host.
 */
export function EmbedSelectionFrame({
  node,
  absoluteX,
  absoluteY,
}: EmbedSelectionFrameProps) {
  const scale = useViewportStore((s) => s.scale);
  const panX = useViewportStore((s) => s.x);
  const panY = useViewportStore((s) => s.y);
  const dpr = window.devicePixelRatio || 1;

  const rect = embedScreenRect(
    absoluteX,
    absoluteY,
    node.width,
    node.height,
    scale,
    panX,
    panY,
    dpr,
  );

  const color = isInComponentContext(node.id)
    ? COMPONENT_SELECTION_COLOR
    : SELECTION_COLOR;

  // Four corner handles (matches drawSelection.ts).
  const corners: Array<{ left: number; top: number }> = [
    { left: 0, top: 0 },
    { left: rect.width, top: 0 },
    { left: 0, top: rect.height },
    { left: rect.width, top: rect.height },
  ];

  return (
    <div
      data-embed-selection-frame
      style={{
        position: "absolute",
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        boxSizing: "border-box",
        border: `1px solid ${color}`,
        borderColor: color,
        pointerEvents: "none",
        zIndex: 11,
      }}
    >
      {corners.map((c, i) => (
        <div
          key={i}
          data-embed-selection-handle
          style={{
            // Integer offsets (no CSS transform) keep the 1px border crisp —
            // a translate() forces a composited layer that softens the edges.
            position: "absolute",
            left: c.left - HANDLE_SIZE / 2,
            top: c.top - HANDLE_SIZE / 2,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            background: "#ffffff",
            border: `1px solid ${color}`,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
}
