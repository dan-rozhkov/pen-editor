import { Container, Graphics } from "pixi.js";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useDragStore } from "@/store/dragStore";
import { useMeasureStore } from "@/store/measureStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { getMarqueeRect, subscribeOverlayState } from "./pixiOverlayState";

const GUIDE_COLOR = 0xff4081;
const DROP_INDICATOR_COLOR = 0x0d99ff;
const MEASURE_COLOR = 0xff4081;
const MARQUEE_FILL = 0x0d99ff;
const MARQUEE_FILL_ALPHA = 0.08;
const MARQUEE_STROKE = 0x0d99ff;
const DRAW_PREVIEW_FILL = 0xcccccc;
const DRAW_PREVIEW_FILL_ALPHA = 0.3;
const DRAW_PREVIEW_STROKE = 0x0d99ff;

/**
 * Create overlay renderer for smart guides, drop indicators, measure lines,
 * drawing preview, and marquee selection.
 * Returns a cleanup function.
 */
export function createOverlayRenderer(overlayContainer: Container): () => void {
  const guidesGfx = new Graphics();
  guidesGfx.label = "smart-guides";
  overlayContainer.addChild(guidesGfx);

  const dropGfx = new Graphics();
  dropGfx.label = "drop-indicator";
  overlayContainer.addChild(dropGfx);

  const measureGfx = new Graphics();
  measureGfx.label = "measure-lines";
  overlayContainer.addChild(measureGfx);

  const drawPreviewGfx = new Graphics();
  drawPreviewGfx.label = "draw-preview";
  overlayContainer.addChild(drawPreviewGfx);

  const marqueeGfx = new Graphics();
  marqueeGfx.label = "marquee-selection";
  overlayContainer.addChild(marqueeGfx);

  function redrawGuides(): void {
    guidesGfx.clear();
    const { guides } = useSmartGuideStore.getState();
    if (guides.length === 0) return;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    for (const guide of guides) {
      if (guide.orientation === "vertical") {
        guidesGfx.moveTo(guide.position, guide.start);
        guidesGfx.lineTo(guide.position, guide.end);
      } else {
        guidesGfx.moveTo(guide.start, guide.position);
        guidesGfx.lineTo(guide.end, guide.position);
      }
      guidesGfx.stroke({ color: GUIDE_COLOR, width: strokeWidth });
    }
  }

  function redrawDropIndicator(): void {
    dropGfx.clear();
    const { dropIndicator } = useDragStore.getState();
    if (!dropIndicator) return;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 2 / scale;

    if (dropIndicator.direction === "horizontal") {
      dropGfx.moveTo(dropIndicator.x, dropIndicator.y);
      dropGfx.lineTo(dropIndicator.x + dropIndicator.length, dropIndicator.y);
    } else {
      dropGfx.moveTo(dropIndicator.x, dropIndicator.y);
      dropGfx.lineTo(dropIndicator.x, dropIndicator.y + dropIndicator.length);
    }
    dropGfx.stroke({ color: DROP_INDICATOR_COLOR, width: strokeWidth });
  }

  function redrawMeasureLines(): void {
    measureGfx.clear();
    const { lines } = useMeasureStore.getState();
    if (lines.length === 0) return;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    for (const line of lines) {
      if (line.orientation === "horizontal") {
        measureGfx.moveTo(line.x, line.y);
        measureGfx.lineTo(line.x + line.length, line.y);
      } else {
        measureGfx.moveTo(line.x, line.y);
        measureGfx.lineTo(line.x, line.y + line.length);
      }
      measureGfx.stroke({
        color: MEASURE_COLOR,
        width: strokeWidth,
      });
    }
  }

  function redrawDrawPreview(): void {
    drawPreviewGfx.clear();
    const { isDrawing, drawStart, drawCurrent } = useDrawModeStore.getState();
    if (!isDrawing || !drawStart || !drawCurrent) return;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    const x = Math.min(drawStart.x, drawCurrent.x);
    const y = Math.min(drawStart.y, drawCurrent.y);
    const w = Math.abs(drawCurrent.x - drawStart.x);
    const h = Math.abs(drawCurrent.y - drawStart.y);

    if (w < 1 && h < 1) return;

    drawPreviewGfx.rect(x, y, w, h);
    drawPreviewGfx.fill({ color: DRAW_PREVIEW_FILL, alpha: DRAW_PREVIEW_FILL_ALPHA });
    drawPreviewGfx.stroke({ color: DRAW_PREVIEW_STROKE, width: strokeWidth });
  }

  function redrawMarquee(): void {
    marqueeGfx.clear();
    const rect = getMarqueeRect();
    if (!rect) return;

    const scale = useViewportStore.getState().scale;
    const strokeWidth = 1 / scale;

    if (rect.width < 1 && rect.height < 1) return;

    marqueeGfx.rect(rect.x, rect.y, rect.width, rect.height);
    marqueeGfx.fill({ color: MARQUEE_FILL, alpha: MARQUEE_FILL_ALPHA });
    marqueeGfx.stroke({ color: MARQUEE_STROKE, width: strokeWidth });
  }

  // Subscribe to stores
  const unsubGuides = useSmartGuideStore.subscribe(redrawGuides);
  const unsubDrop = useDragStore.subscribe(redrawDropIndicator);
  const unsubMeasure = useMeasureStore.subscribe(redrawMeasureLines);
  const unsubDrawMode = useDrawModeStore.subscribe(redrawDrawPreview);
  const unsubMarquee = subscribeOverlayState(redrawMarquee);
  const unsubViewport = useViewportStore.subscribe(() => {
    redrawGuides();
    redrawDropIndicator();
    redrawMeasureLines();
    redrawDrawPreview();
    redrawMarquee();
  });

  // Initial draw
  redrawGuides();
  redrawDropIndicator();
  redrawMeasureLines();
  redrawDrawPreview();
  redrawMarquee();

  return () => {
    unsubGuides();
    unsubDrop();
    unsubMeasure();
    unsubDrawMode();
    unsubMarquee();
    unsubViewport();
    guidesGfx.destroy();
    dropGfx.destroy();
    measureGfx.destroy();
    drawPreviewGfx.destroy();
    marqueeGfx.destroy();
  };
}
