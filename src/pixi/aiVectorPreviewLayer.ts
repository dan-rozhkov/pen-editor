import { Container, Graphics } from "pixi.js";
import type { PathAnchor, PathNode } from "@/types/scene";
import { useAiVectorPreviewStore, type AiVectorPreviewDraft } from "@/store/aiVectorPreviewStore";
import { useViewportStore } from "@/store/viewportStore";
import { drawPath } from "./renderers/pathRenderer";

const PREVIEW_ACCENT_COLOR = 0x0d99ff;
const DEFAULT_PREVIEW_STROKE = {
  fill: "#0d99ff",
  thickness: 1.5,
  cap: "round",
  join: "round",
} as const;

interface PreviewEntry {
  container: Container;
  pathGfx: Graphics;
  markerGfx: Graphics;
}

function drawAnchorMarker(gfx: Graphics, x: number, y: number, radius: number, scale: number): void {
  gfx.rect(x - radius, y - radius, radius * 2, radius * 2);
  gfx.fill({ color: PREVIEW_ACCENT_COLOR });
  gfx.stroke({ color: 0xffffff, width: 1 / scale });
}

function drawHandleMarker(
  gfx: Graphics,
  anchorX: number,
  anchorY: number,
  hx: number,
  hy: number,
  radius: number,
  scale: number,
): void {
  gfx.moveTo(anchorX, anchorY);
  gfx.lineTo(hx, hy);
  gfx.stroke({ color: PREVIEW_ACCENT_COLOR, width: 1 / scale, alpha: 0.6 });
  gfx.circle(hx, hy, radius);
  gfx.fill({ color: 0xffffff });
  gfx.stroke({ color: PREVIEW_ACCENT_COLOR, width: 1 / scale });
}

/** Draw anchor squares + bezier-handle markers in container-local coordinates (bounds origin subtracted). */
function renderMarkers(
  gfx: Graphics,
  points: PathAnchor[],
  bounds: { x: number; y: number },
  scale: number,
): void {
  const anchorRadius = 4 / scale;
  const handleRadius = 3 / scale;

  for (const point of points) {
    const lx = point.x - bounds.x;
    const ly = point.y - bounds.y;
    if (point.handleOut) {
      drawHandleMarker(
        gfx,
        lx,
        ly,
        point.handleOut.x - bounds.x,
        point.handleOut.y - bounds.y,
        handleRadius,
        scale,
      );
    }
    if (point.handleIn) {
      drawHandleMarker(
        gfx,
        lx,
        ly,
        point.handleIn.x - bounds.x,
        point.handleIn.y - bounds.y,
        handleRadius,
        scale,
      );
    }
  }

  for (const point of points) {
    drawAnchorMarker(gfx, point.x - bounds.x, point.y - bounds.y, anchorRadius, scale);
  }
}

function renderDraft(entry: PreviewEntry, draft: AiVectorPreviewDraft, scale: number): void {
  entry.container.position.set(draft.bounds.x, draft.bounds.y);

  entry.pathGfx.clear();
  // Only hand off to drawPath once there's real segment geometry — a lone `M`
  // anchor (or a defensively-empty geometry string) must never reach it, or
  // its malformed-SVG catch block would fall back to drawing a rectangle.
  if (draft.points.length >= 2 && draft.geometry) {
    const tempNode: PathNode = {
      id: `ai-vector-preview:${draft.toolCallId}`,
      type: "path",
      x: draft.bounds.x,
      y: draft.bounds.y,
      width: draft.bounds.width,
      height: draft.bounds.height,
      geometry: draft.geometry,
      geometryBounds: { ...draft.bounds },
      // Fill only once the contour is closed — an open in-progress contour
      // must never appear filled even if a (malformed/early) FILL landed.
      fill: draft.closed ? draft.fill : undefined,
      pathStroke: draft.stroke
        ? { fill: draft.stroke.color, thickness: draft.stroke.width, cap: "round", join: "round" }
        : { ...DEFAULT_PREVIEW_STROKE },
    };
    drawPath(entry.pathGfx, tempNode);
  }

  entry.markerGfx.clear();
  renderMarkers(entry.markerGfx, draft.points, draft.bounds, scale || 1);
}

/**
 * Dedicated Pixi overlay layer for streaming `draw_vector` previews. Reads
 * `useAiVectorPreviewStore` and renders each active draft as world-space
 * path + anchor-marker geometry, keyed so drafts update in place. Writes
 * nothing to sceneStore/selection/layout/hit-test/raster cache — this is a
 * pure, transient visualization outside the cached scene frames.
 */
export function createAiVectorPreviewLayer(overlayContainer: Container): () => void {
  const root = new Container();
  root.label = "ai-vector-previews";
  overlayContainer.addChild(root);

  const entries = new Map<string, PreviewEntry>();
  let rafId: number | null = null;

  function createEntry(): PreviewEntry {
    const container = new Container();
    container.label = "ai-vector-preview";
    const pathGfx = new Graphics();
    pathGfx.label = "ai-vector-preview-path";
    const markerGfx = new Graphics();
    markerGfx.label = "ai-vector-preview-markers";
    container.addChild(pathGfx);
    container.addChild(markerGfx);
    return { container, pathGfx, markerGfx };
  }

  function removeEntry(key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    root.removeChild(entry.container);
    entry.container.destroy({ children: true });
    entries.delete(key);
  }

  function flush(): void {
    rafId = null;
    const { drafts } = useAiVectorPreviewStore.getState();
    const scale = useViewportStore.getState().scale || 1;

    for (const key of [...entries.keys()]) {
      if (!(key in drafts)) removeEntry(key);
    }

    for (const [key, draft] of Object.entries(drafts)) {
      let entry = entries.get(key);
      if (!entry) {
        entry = createEntry();
        root.addChild(entry.container);
        entries.set(key, entry);
      }
      renderDraft(entry, draft, scale);
    }
  }

  function scheduleFlush(): void {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(flush);
  }

  const unsubscribe = useAiVectorPreviewStore.subscribe(scheduleFlush);
  // Anchor/handle marker sizes and the default stroke width are baked at the
  // current viewport scale (`4 / scale`, `1 / scale`), and every other
  // overlay in OverlayRenderer.ts subscribes to the viewport for the same
  // reason. Without this, zooming while a preview is staged (stream stalled,
  // or the draft sits in `committing` awaiting the rAF finalize) leaves
  // markers baked at a stale scale until an unrelated store update arrives.
  const unsubscribeViewport = useViewportStore.subscribe(scheduleFlush);

  // Initial draw so a draft already present at mount time (unlikely, but
  // matches the rest of OverlayRenderer's "draw once, then subscribe" shape).
  flush();

  return () => {
    unsubscribe();
    unsubscribeViewport();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    for (const key of [...entries.keys()]) removeEntry(key);
    overlayContainer.removeChild(root);
    root.destroy();
  };
}
