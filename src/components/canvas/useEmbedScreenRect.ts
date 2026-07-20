import { useViewportStore } from "@/store/viewportStore";
import { embedScreenRect, type ScreenRect } from "./embedLayerGeometry";

/**
 * Subscribe to the viewport transform and map a node's world-space rect to a
 * device-pixel-snapped screen rect. Shared by the DOM-rendered embed overlays
 * (selection frame, agent button) that must track pan/zoom alongside the
 * canvas.
 */
export function useEmbedScreenRect(
  absoluteX: number,
  absoluteY: number,
  width: number,
  height: number,
): ScreenRect {
  const scale = useViewportStore((s) => s.scale);
  const panX = useViewportStore((s) => s.x);
  const panY = useViewportStore((s) => s.y);
  const dpr = window.devicePixelRatio || 1;

  return embedScreenRect(absoluteX, absoluteY, width, height, scale, panX, panY, dpr);
}
