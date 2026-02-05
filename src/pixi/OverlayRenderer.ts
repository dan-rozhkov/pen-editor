import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useDragStore } from "@/store/dragStore";
import { useMeasureStore } from "@/store/measureStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { getMarqueeRect, subscribeOverlayState } from "./pixiOverlayState";

const GUIDE_COLOR = 0xff3366;
const DROP_INDICATOR_COLOR = 0x0d99ff;
const MEASURE_COLOR = 0xf24822;
const MEASURE_LABEL_TEXT_COLOR = "#ffffff";
const MEASURE_LABEL_FONT_SIZE = 11;
const MEASURE_LABEL_PADDING_X = 4;
const MEASURE_LABEL_PADDING_Y = 2;
const MEASURE_LABEL_RADIUS = 2;
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

  const measureLabels = new Container();
  measureLabels.label = "measure-labels";
  overlayContainer.addChild(measureLabels);

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
    measureLabels.removeChildren().forEach((child) => child.destroy({ children: true }));

    const { lines } = useMeasureStore.getState();
    if (lines.length === 0) return;

    const scale = useViewportStore.getState().scale;
    const invScale = 1 / scale;
    const strokeWidth = invScale;
    const capSize = 4 * invScale;

    for (const line of lines) {
      let x1: number, y1: number, x2: number, y2: number;
      if (line.orientation === "horizontal") {
        x1 = line.x;
        y1 = line.y;
        x2 = line.x + line.length;
        y2 = line.y;
      } else {
        x1 = line.x;
        y1 = line.y;
        x2 = line.x;
        y2 = line.y + line.length;
      }

      // Main line
      measureGfx.moveTo(x1, y1);
      measureGfx.lineTo(x2, y2);
      // End caps
      if (line.orientation === "horizontal") {
        measureGfx.moveTo(x1, y1 - capSize);
        measureGfx.lineTo(x1, y1 + capSize);
        measureGfx.moveTo(x2, y2 - capSize);
        measureGfx.lineTo(x2, y2 + capSize);
      } else {
        measureGfx.moveTo(x1 - capSize, y1);
        measureGfx.lineTo(x1 + capSize, y1);
        measureGfx.moveTo(x2 - capSize, y2);
        measureGfx.lineTo(x2 + capSize, y2);
      }

      measureGfx.stroke({
        color: MEASURE_COLOR,
        width: strokeWidth,
      });

      // Centered label block (fixed screen size via inverse scaling).
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;
      const labelGroup = new Container();
      labelGroup.position.set(centerX, centerY);
      labelGroup.scale.set(invScale);

      const textStyle = new TextStyle({
        fontFamily: "system-ui, -apple-system, sans-serif",
        fontSize: MEASURE_LABEL_FONT_SIZE,
        fill: MEASURE_LABEL_TEXT_COLOR,
      });
      const text = new Text({ text: line.label, style: textStyle });
      const bgWidth = text.width + MEASURE_LABEL_PADDING_X * 2;
      const bgHeight = MEASURE_LABEL_FONT_SIZE + MEASURE_LABEL_PADDING_Y * 2;

      const bg = new Graphics();
      bg.roundRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, MEASURE_LABEL_RADIUS);
      bg.fill(MEASURE_COLOR);

      text.position.set(-text.width / 2, -bgHeight / 2 + MEASURE_LABEL_PADDING_Y);

      labelGroup.addChild(bg);
      labelGroup.addChild(text);
      measureLabels.addChild(labelGroup);
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
    measureLabels.destroy({ children: true });
    drawPreviewGfx.destroy();
    marqueeGfx.destroy();
  };
}
