import { useSceneStore } from "@/store/sceneStore";
import type { EmbedNode, FlatFrameNode } from "@/types/scene";
import { useEmbedScreenRect } from "./useEmbedScreenRect";

const SELECTION_COLOR = "#0d99ff";
const COMPONENT_SELECTION_COLOR = "#8b5cf6";
// Mirror the Pixi overlay (drawSelection.ts): an 8px white handle fill with a
// 1px stroke that is *centered* on the perimeter (Pixi's default stroke
// alignment). A centered CSS outline stroke straddles the node edge, so we
// stroke straddles its path by half its width, so to reproduce it with CSS
// (whose borders sit fully inside a border-box) we grow the element by the
// stroke width and offset it by half the stroke. This makes the handle's outer
// box HANDLE_BOX (9px) with a 7px white interior — matching Pixi exactly.
const HANDLE_FILL_SIZE = 8;
const HANDLE_STROKE_WIDTH = 1;
const HANDLE_BOX = HANDLE_FILL_SIZE + HANDLE_STROKE_WIDTH;
const HANDLE_OFFSET = HANDLE_BOX / 2;

interface EmbedSelectionFrameProps {
  node: EmbedNode;
  absoluteX: number;
  absoluteY: number;
  outlineStrokeWidth?: number;
  showHandles?: boolean;
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
  outlineStrokeWidth = 1,
  showHandles = true,
}: EmbedSelectionFrameProps) {
  const rect = useEmbedScreenRect(absoluteX, absoluteY, node.width, node.height);

  const color = isInComponentContext(node.id)
    ? COMPONENT_SELECTION_COLOR
    : SELECTION_COLOR;

  const outlineStrokeHalf = outlineStrokeWidth / 2;

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
        pointerEvents: "none",
        zIndex: 11,
      }}
    >
      {/* Outline centered on the node edge. Grown by half the stroke width on
          every side so the border band
          straddles the edge instead of sitting inside it. */}
      <div
        data-embed-selection-outline
        style={{
          position: "absolute",
          left: -outlineStrokeHalf,
          top: -outlineStrokeHalf,
          right: -outlineStrokeHalf,
          bottom: -outlineStrokeHalf,
          border: `${outlineStrokeWidth}px solid ${color}`,
          boxSizing: "border-box",
          pointerEvents: "none",
        }}
      />
      {showHandles && corners.map((c, i) => (
        <div
          key={i}
          data-embed-selection-handle
          style={{
            position: "absolute",
            left: c.left - HANDLE_OFFSET,
            top: c.top - HANDLE_OFFSET,
            width: HANDLE_BOX,
            height: HANDLE_BOX,
            background: "#ffffff",
            border: `${HANDLE_STROKE_WIDTH}px solid ${color}`,
            boxSizing: "border-box",
            pointerEvents: "none",
          }}
        />
      ))}
    </div>
  );
}
