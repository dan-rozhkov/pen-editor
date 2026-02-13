import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useDragStore } from "@/store/dragStore";
import { useMeasureStore } from "@/store/measureStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { usePixelGridStore } from "@/store/pixelGridStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
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
const PIXEL_GRID_MIN_SCALE = 8;
const PIXEL_GRID_FADE_SCALE = 10;
const PIXEL_GRID_BASE_OPACITY = 0.03;
const PIXEL_GRID_LIGHT_COLOR = 0x000000;
const PIXEL_GRID_DARK_COLOR = 0xffffff;
const MEASURE_LABEL_STYLE = new TextStyle({
  fontFamily: "system-ui, -apple-system, sans-serif",
  fontSize: MEASURE_LABEL_FONT_SIZE,
  fill: MEASURE_LABEL_TEXT_COLOR,
});

type MeasureLabelEntry = {
  group: Container;
  bg: Graphics;
  text: Text;
};

/**
 * Create overlay renderer for smart guides, drop indicators, measure lines,
 * drawing preview, and marquee selection.
 * Returns a cleanup function.
 */
export function createOverlayRenderer(
  overlayContainer: Container,
  getViewportSize: () => { width: number; height: number },
): () => void {
  const pixelGridGfx = new Graphics();
  pixelGridGfx.label = "pixel-grid";
  overlayContainer.addChild(pixelGridGfx);

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
  const measureLabelPool: MeasureLabelEntry[] = [];
  const activeMeasureLabels: MeasureLabelEntry[] = [];
  let lastViewport = useViewportStore.getState();

  function recycleMeasureLabels(): void {
    while (activeMeasureLabels.length > 0) {
      const entry = activeMeasureLabels.pop();
      if (!entry) break;
      measureLabels.removeChild(entry.group);
      measureLabelPool.push(entry);
    }
  }

  function getMeasureLabelEntry(): MeasureLabelEntry {
    const pooled = measureLabelPool.pop();
    if (pooled) return pooled;
    const group = new Container();
    const bg = new Graphics();
    const text = new Text({ text: "", style: MEASURE_LABEL_STYLE });
    group.addChild(bg);
    group.addChild(text);
    return { group, bg, text };
  }

  function redrawPixelGrid(): void {
    pixelGridGfx.clear();

    const { showPixelGrid } = usePixelGridStore.getState();
    const { uiTheme } = useUIThemeStore.getState();
    const { scale, x, y } = useViewportStore.getState();
    if (!showPixelGrid || scale < PIXEL_GRID_MIN_SCALE) return;

    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const t = Math.min(
      1,
      (scale - PIXEL_GRID_MIN_SCALE) /
        (PIXEL_GRID_FADE_SCALE - PIXEL_GRID_MIN_SCALE),
    );
    const alpha = PIXEL_GRID_BASE_OPACITY * t;
    if (alpha <= 0) return;

    const color =
      uiTheme === "dark" ? PIXEL_GRID_DARK_COLOR : PIXEL_GRID_LIGHT_COLOR;

    const worldMinX = -x / scale;
    const worldMaxX = (-x + viewportWidth) / scale;
    const worldMinY = -y / scale;
    const worldMaxY = (-y + viewportHeight) / scale;

    const startX = Math.floor(worldMinX);
    const endX = Math.ceil(worldMaxX);
    const startY = Math.floor(worldMinY);
    const endY = Math.ceil(worldMaxY);

    const strokeWidth = 1 / scale;

    for (let wx = startX; wx <= endX; wx++) {
      pixelGridGfx.moveTo(wx, worldMinY);
      pixelGridGfx.lineTo(wx, worldMaxY);
      pixelGridGfx.stroke({ color, width: strokeWidth, alpha });
    }

    for (let wy = startY; wy <= endY; wy++) {
      pixelGridGfx.moveTo(worldMinX, wy);
      pixelGridGfx.lineTo(worldMaxX, wy);
      pixelGridGfx.stroke({ color, width: strokeWidth, alpha });
    }
  }

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
    recycleMeasureLabels();

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
      const entry = getMeasureLabelEntry();
      entry.group.position.set(centerX, centerY);
      entry.group.scale.set(invScale);
      entry.text.text = line.label;
      const bgWidth = entry.text.width + MEASURE_LABEL_PADDING_X * 2;
      const bgHeight = MEASURE_LABEL_FONT_SIZE + MEASURE_LABEL_PADDING_Y * 2;
      entry.bg.clear();
      entry.bg.roundRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, MEASURE_LABEL_RADIUS);
      entry.bg.fill(MEASURE_COLOR);
      entry.text.position.set(-entry.text.width / 2, -bgHeight / 2 + MEASURE_LABEL_PADDING_Y);
      measureLabels.addChild(entry.group);
      activeMeasureLabels.push(entry);
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
  const unsubPixelGrid = usePixelGridStore.subscribe(redrawPixelGrid);
  const unsubUITheme = useUIThemeStore.subscribe(redrawPixelGrid);
  const unsubGuides = useSmartGuideStore.subscribe(redrawGuides);
  const unsubDrop = useDragStore.subscribe(redrawDropIndicator);
  const unsubMeasure = useMeasureStore.subscribe(redrawMeasureLines);
  const unsubDrawMode = useDrawModeStore.subscribe(redrawDrawPreview);
  const unsubMarquee = subscribeOverlayState(redrawMarquee);
  const unsubViewport = useViewportStore.subscribe((state) => {
    const scaleChanged = state.scale !== lastViewport.scale;
    const panChanged = state.x !== lastViewport.x || state.y !== lastViewport.y;
    lastViewport = state;
    if (panChanged || scaleChanged) {
      redrawPixelGrid();
    }
    if (scaleChanged) {
      redrawGuides();
      redrawDropIndicator();
      redrawMeasureLines();
      redrawDrawPreview();
      redrawMarquee();
    }
  });

  // Initial draw
  redrawPixelGrid();
  redrawGuides();
  redrawDropIndicator();
  redrawMeasureLines();
  redrawDrawPreview();
  redrawMarquee();

  return () => {
    unsubPixelGrid();
    unsubUITheme();
    unsubGuides();
    unsubDrop();
    unsubMeasure();
    unsubDrawMode();
    unsubMarquee();
    unsubViewport();
    pixelGridGfx.destroy();
    guidesGfx.destroy();
    dropGfx.destroy();
    measureGfx.destroy();
    recycleMeasureLabels();
    while (measureLabelPool.length > 0) {
      const entry = measureLabelPool.pop();
      if (!entry) break;
      entry.group.destroy({ children: true });
    }
    measureLabels.destroy({ children: true });
    drawPreviewGfx.destroy();
    marqueeGfx.destroy();
  };
}
