import { Container, Graphics, Text } from "pixi.js";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useDragStore } from "@/store/dragStore";
import { useMeasureStore } from "@/store/measureStore";
import { useViewportStore } from "@/store/viewportStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { usePixelGridStore } from "@/store/pixelGridStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useConnectorStore } from "@/store/connectorStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useLayoutStore } from "@/store/layoutStore";
import { usePenToolStore } from "@/store/penToolStore";
import type { AnchorPosition, PathAnchor } from "@/types/scene";
import { getAnchorWorldPosition, drawArrowhead, shortenLineEnd } from "@/utils/connectorUtils";
import { getMarqueeRect, subscribeOverlayState } from "./pixiOverlayState";
import {
  getAnchorScreenPoints,
  getEditedPathNode,
  getNodeAbsolutePosition,
} from "./interaction/pathEditGeometry";
import {
  FLOATING_LABEL_FONT_SIZE,
  FLOATING_LABEL_PADDING_X,
  FLOATING_LABEL_PADDING_Y,
  FLOATING_LABEL_RADIUS,
  FLOATING_LABEL_STYLE,
} from "./selectionOverlay/constants";

const GUIDE_COLOR = 0xff3366;
const PERSISTENT_GUIDE_COLOR = GUIDE_COLOR;
const DROP_INDICATOR_COLOR = 0x0d99ff;
const MEASURE_COLOR = 0xf24822;
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
const PEN_ACCENT_COLOR = 0x0d99ff;

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
  measureLabelContainer: Container,
  getViewportSize: () => { width: number; height: number },
): () => void {
  const pixelGridGfx = new Graphics();
  pixelGridGfx.label = "pixel-grid";
  overlayContainer.addChild(pixelGridGfx);

  const guidesGfx = new Graphics();
  guidesGfx.label = "smart-guides";
  overlayContainer.addChild(guidesGfx);

  const persistentGuidesGfx = new Graphics();
  persistentGuidesGfx.label = "persistent-guides";
  overlayContainer.addChild(persistentGuidesGfx);

  const dropGfx = new Graphics();
  dropGfx.label = "drop-indicator";
  overlayContainer.addChild(dropGfx);

  const measureGfx = new Graphics();
  measureGfx.label = "measure-lines";
  overlayContainer.addChild(measureGfx);

  const measureLabels = new Container();
  measureLabels.label = "measure-labels";
  measureLabelContainer.addChild(measureLabels);

  const drawPreviewGfx = new Graphics();
  drawPreviewGfx.label = "draw-preview";
  overlayContainer.addChild(drawPreviewGfx);

  const marqueeGfx = new Graphics();
  marqueeGfx.label = "marquee-selection";
  overlayContainer.addChild(marqueeGfx);

  const connectorPreviewGfx = new Graphics();
  connectorPreviewGfx.label = "connector-preview";
  overlayContainer.addChild(connectorPreviewGfx);

  const penPreviewGfx = new Graphics();
  penPreviewGfx.label = "pen-preview";
  overlayContainer.addChild(penPreviewGfx);

  const pathEditGfx = new Graphics();
  pathEditGfx.label = "path-edit";
  overlayContainer.addChild(pathEditGfx);

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
    const text = new Text({ text: "", style: FLOATING_LABEL_STYLE });
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

  function redrawPersistentGuides(): void {
    persistentGuidesGfx.clear();
    // Guides stay visible/functional even if the ruler strips are hidden —
    // only guide *creation* requires the rulers to be shown.
    const { guides } = useGuidesStore.getState();
    if (guides.length === 0) return;

    const { scale, x, y } = useViewportStore.getState();
    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    if (viewportWidth <= 0 || viewportHeight <= 0) return;

    const worldMinX = -x / scale;
    const worldMaxX = (-x + viewportWidth) / scale;
    const worldMinY = -y / scale;
    const worldMaxY = (-y + viewportHeight) / scale;

    const strokeWidth = 1 / scale;

    for (const guide of guides) {
      if (guide.orientation === "vertical") {
        persistentGuidesGfx.moveTo(guide.position, worldMinY);
        persistentGuidesGfx.lineTo(guide.position, worldMaxY);
      } else {
        persistentGuidesGfx.moveTo(worldMinX, guide.position);
        persistentGuidesGfx.lineTo(worldMaxX, guide.position);
      }
      persistentGuidesGfx.stroke({ color: PERSISTENT_GUIDE_COLOR, width: strokeWidth });
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
      const bgWidth = entry.text.width + FLOATING_LABEL_PADDING_X * 2;
      const bgHeight = FLOATING_LABEL_FONT_SIZE + FLOATING_LABEL_PADDING_Y * 2;
      entry.bg.clear();
      entry.bg.roundRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, FLOATING_LABEL_RADIUS);
      entry.bg.fill(MEASURE_COLOR);
      entry.text.position.set(-entry.text.width / 2, -bgHeight / 2 + FLOATING_LABEL_PADDING_Y);
      measureLabels.addChild(entry.group);
      activeMeasureLabels.push(entry);
    }
  }

  function redrawDrawPreview(): void {
    drawPreviewGfx.clear();
    const { isDrawing, drawStart, drawCurrent, pencilPoints, activeTool } = useDrawModeStore.getState();
    if (!isDrawing) return;

    const scale = useViewportStore.getState().scale;

    // Pencil tool: draw polyline preview
    if (activeTool === "pencil" && pencilPoints.length > 1) {
      const { pencilSettings } = useDrawModeStore.getState();
      const previewColor = parseInt(pencilSettings.color.replace('#', ''), 16);
      drawPreviewGfx.moveTo(pencilPoints[0].x, pencilPoints[0].y);
      for (let i = 1; i < pencilPoints.length; i++) {
        drawPreviewGfx.lineTo(pencilPoints[i].x, pencilPoints[i].y);
      }
      drawPreviewGfx.stroke({ color: previewColor, width: pencilSettings.thickness / scale, alpha: pencilSettings.opacity });
      return;
    }

    // Standard draw tools: rectangle preview
    if (!drawStart || !drawCurrent) return;

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

  function drawAnchorCircles(nodeId: string, highlightAnchor?: AnchorPosition): void {
    const nodes = useSceneStore.getState().getNodes();
    const calculateLayoutForFrame = useLayoutStore.getState().calculateLayoutForFrame;
    const scale = useViewportStore.getState().scale;
    const radius = 4 / scale;
    const anchors: AnchorPosition[] = ["top", "right", "bottom", "left"];

    for (const anchor of anchors) {
      const pos = getAnchorWorldPosition(nodeId, anchor, nodes, calculateLayoutForFrame);
      if (!pos) continue;
      const isHighlighted = anchor === highlightAnchor;
      connectorPreviewGfx.circle(pos.x, pos.y, radius);
      if (isHighlighted) {
        connectorPreviewGfx.fill({ color: 0x0d99ff, alpha: 1 });
      } else {
        connectorPreviewGfx.fill({ color: 0xffffff, alpha: 1 });
        connectorPreviewGfx.circle(pos.x, pos.y, radius);
        connectorPreviewGfx.stroke({ color: 0x0d99ff, width: 1 / scale });
      }
    }
  }

  function redrawConnectorPreview(): void {
    connectorPreviewGfx.clear();

    const { activeTool } = useDrawModeStore.getState();
    if (activeTool !== "connector") return;

    const connState = useConnectorStore.getState();
    const scale = useViewportStore.getState().scale;

    if (connState.sourceNodeId && connState.sourceAnchor) {
      // Draw source anchor (filled blue)
      drawAnchorCircles(connState.sourceNodeId, connState.sourceAnchor);

      // Draw target anchors if hovering
      if (connState.hoveredNodeId && connState.hoveredNodeId !== connState.sourceNodeId) {
        drawAnchorCircles(connState.hoveredNodeId, connState.hoveredAnchor ?? undefined);
      }

      // Draw preview line from source anchor to cursor/target
      const nodes = useSceneStore.getState().getNodes();
      const calcLayout = useLayoutStore.getState().calculateLayoutForFrame;
      const startPos = getAnchorWorldPosition(connState.sourceNodeId, connState.sourceAnchor, nodes, calcLayout);
      if (startPos && connState.previewEndPoint) {
        let endPos = connState.previewEndPoint;
        if (connState.hoveredNodeId && connState.hoveredAnchor) {
          const targetPos = getAnchorWorldPosition(connState.hoveredNodeId, connState.hoveredAnchor, nodes, calcLayout);
          if (targetPos) endPos = targetPos;
        }

        const arrowSize = 8 / scale;
        const lineEnd = shortenLineEnd(startPos.x, startPos.y, endPos.x, endPos.y, arrowSize);
        connectorPreviewGfx.moveTo(startPos.x, startPos.y);
        connectorPreviewGfx.lineTo(lineEnd.x, lineEnd.y);
        connectorPreviewGfx.stroke({ color: 0x0d99ff, width: 2 / scale });

        drawArrowhead(connectorPreviewGfx, startPos.x, startPos.y, endPos.x, endPos.y, arrowSize, { color: 0x0d99ff });
      }
    } else {
      // Idle: show anchors on nearest node (uses connector store which has proximity detection)
      if (connState.hoveredNodeId) {
        drawAnchorCircles(connState.hoveredNodeId);
      }
    }
  }

  function drawAnchorMarker(gfx: Graphics, x: number, y: number, radius: number, scale: number, filled: boolean): void {
    gfx.rect(x - radius, y - radius, radius * 2, radius * 2);
    gfx.fill({ color: filled ? PEN_ACCENT_COLOR : 0xffffff });
    gfx.stroke({ color: PEN_ACCENT_COLOR, width: 1 / scale });
  }

  function drawHandleMarker(gfx: Graphics, anchorX: number, anchorY: number, hx: number, hy: number, radius: number, scale: number, filled: boolean): void {
    gfx.moveTo(anchorX, anchorY);
    gfx.lineTo(hx, hy);
    gfx.stroke({ color: PEN_ACCENT_COLOR, width: 1 / scale });
    gfx.circle(hx, hy, radius);
    gfx.fill({ color: filled ? PEN_ACCENT_COLOR : 0xffffff });
    gfx.stroke({ color: PEN_ACCENT_COLOR, width: 1 / scale });
  }

  /** Pen-tool draw preview: committed segments so far + the live "next segment" to the cursor. */
  function redrawPenPreview(): void {
    penPreviewGfx.clear();
    const { activeTool } = useDrawModeStore.getState();
    if (activeTool !== "pen") return;
    const pen = usePenToolStore.getState();
    if (!pen.isDrafting) return;

    const scale = useViewportStore.getState().scale || 1;
    const anchorRadius = 4 / scale;
    const handleRadius = 3 / scale;
    const strokeWidth = 1.5 / scale;

    const anchors: PathAnchor[] = pen.pendingAnchor ? [...pen.anchors, pen.pendingAnchor] : pen.anchors;

    if (anchors.length > 0) {
      penPreviewGfx.moveTo(anchors[0].x, anchors[0].y);
      for (let i = 0; i < anchors.length - 1; i++) {
        const a = anchors[i];
        const b = anchors[i + 1];
        if (a.handleOut || b.handleIn) {
          const cp1 = a.handleOut ?? { x: a.x, y: a.y };
          const cp2 = b.handleIn ?? { x: b.x, y: b.y };
          penPreviewGfx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, b.x, b.y);
        } else {
          penPreviewGfx.lineTo(b.x, b.y);
        }
      }
      penPreviewGfx.stroke({ color: PEN_ACCENT_COLOR, width: strokeWidth });
    }

    // Live segment following the cursor to where the next click will land.
    const last = anchors[anchors.length - 1];
    if (last && !pen.pendingAnchor && pen.cursorWorld) {
      penPreviewGfx.moveTo(last.x, last.y);
      if (last.handleOut) {
        penPreviewGfx.bezierCurveTo(
          last.handleOut.x, last.handleOut.y,
          pen.cursorWorld.x, pen.cursorWorld.y,
          pen.cursorWorld.x, pen.cursorWorld.y,
        );
      } else {
        penPreviewGfx.lineTo(pen.cursorWorld.x, pen.cursorWorld.y);
      }
      penPreviewGfx.stroke({ color: PEN_ACCENT_COLOR, width: strokeWidth, alpha: 0.6 });
    }

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      if (a.handleOut) drawHandleMarker(penPreviewGfx, a.x, a.y, a.handleOut.x, a.handleOut.y, handleRadius, scale, false);
      if (a.handleIn) drawHandleMarker(penPreviewGfx, a.x, a.y, a.handleIn.x, a.handleIn.y, handleRadius, scale, false);
      // Highlight the first anchor when it's close enough to close the contour.
      const isCloseTarget = i === 0 && pen.cursorWorld && anchors.length >= 2 &&
        Math.hypot(pen.cursorWorld.x - a.x, pen.cursorWorld.y - a.y) <= 7 / scale;
      drawAnchorMarker(penPreviewGfx, a.x, a.y, isCloseTarget ? anchorRadius * 1.5 : anchorRadius, scale, !!isCloseTarget);
    }
  }

  /** Path point-edit mode overlay: anchors + bezier handles as a screen-space (world-drawn) Graphics layer. */
  function redrawPathEdit(): void {
    pathEditGfx.clear();
    const edited = getEditedPathNode();
    if (!edited) return;
    const absPos = getNodeAbsolutePosition(edited.id);
    if (!absPos) return;

    const scale = useViewportStore.getState().scale || 1;
    const anchorRadius = 4 / scale;
    const handleRadius = 3 / scale;
    const pen = usePenToolStore.getState();

    const screenPoints = getAnchorScreenPoints(edited.node, absPos);
    for (const sp of screenPoints) {
      if (sp.handleOut) {
        const isHovered = pen.hoveredHandle?.anchorIndex === sp.index && pen.hoveredHandle.which === "out";
        drawHandleMarker(pathEditGfx, sp.pos.x, sp.pos.y, sp.handleOut.x, sp.handleOut.y, isHovered ? handleRadius * 1.3 : handleRadius, scale, isHovered);
      }
      if (sp.handleIn) {
        const isHovered = pen.hoveredHandle?.anchorIndex === sp.index && pen.hoveredHandle.which === "in";
        drawHandleMarker(pathEditGfx, sp.pos.x, sp.pos.y, sp.handleIn.x, sp.handleIn.y, isHovered ? handleRadius * 1.3 : handleRadius, scale, isHovered);
      }
    }
    for (const sp of screenPoints) {
      const isHovered = pen.hoveredAnchorIndex === sp.index;
      drawAnchorMarker(pathEditGfx, sp.pos.x, sp.pos.y, isHovered ? anchorRadius * 1.3 : anchorRadius, scale, isHovered);
    }
  }

  // Phase 5: Batch viewport-triggered overlay redraws via dirty flags + RAF.
  // Interactive store subscriptions stay synchronous to avoid perceptible lag
  // on guides/draw preview/drop indicators during drag/draw.
  const DIRTY_GRID = 1;
  const DIRTY_GUIDES = 2;
  const DIRTY_DROP = 4;
  const DIRTY_MEASURE = 8;
  const DIRTY_DRAW = 16;
  const DIRTY_MARQUEE = 32;
  const DIRTY_CONNECTOR = 64;
  const DIRTY_PERSISTENT_GUIDES = 128;
  const DIRTY_PEN_PREVIEW = 256;
  const DIRTY_PATH_EDIT = 512;
  const DIRTY_ALL_SCALE = DIRTY_GUIDES | DIRTY_DROP | DIRTY_MEASURE | DIRTY_DRAW | DIRTY_MARQUEE | DIRTY_CONNECTOR | DIRTY_PERSISTENT_GUIDES;
  let dirtyFlags = 0;
  let overlayRafId: number | null = null;

  function flushOverlayRedraw(): void {
    overlayRafId = null;
    const flags = dirtyFlags;
    dirtyFlags = 0;
    if (flags & DIRTY_GRID) redrawPixelGrid();
    if (flags & DIRTY_GUIDES) redrawGuides();
    if (flags & DIRTY_DROP) redrawDropIndicator();
    if (flags & DIRTY_MEASURE) redrawMeasureLines();
    if (flags & DIRTY_DRAW) redrawDrawPreview();
    if (flags & DIRTY_MARQUEE) redrawMarquee();
    if (flags & DIRTY_CONNECTOR) redrawConnectorPreview();
    if (flags & DIRTY_PERSISTENT_GUIDES) redrawPersistentGuides();
    if (flags & DIRTY_PEN_PREVIEW) redrawPenPreview();
    if (flags & DIRTY_PATH_EDIT) redrawPathEdit();
  }

  function scheduleOverlayRedraw(flags: number): void {
    dirtyFlags |= flags;
    if (overlayRafId !== null) return;
    overlayRafId = requestAnimationFrame(flushOverlayRedraw);
  }

  // Interactive store subscriptions — synchronous for zero-latency feedback
  const unsubGuides = useSmartGuideStore.subscribe(redrawGuides);
  const unsubDrop = useDragStore.subscribe(redrawDropIndicator);
  const unsubDrawMode = useDrawModeStore.subscribe(redrawDrawPreview);
  const unsubMarquee = subscribeOverlayState(redrawMarquee);
  const unsubMeasure = useMeasureStore.subscribe(redrawMeasureLines);
  const unsubConnector = useConnectorStore.subscribe(redrawConnectorPreview);
  const unsubDrawModeForPen = useDrawModeStore.subscribe(redrawPenPreview);
  // Pen-store updates fire on every pointermove while drafting/dragging a
  // handle (cursor tracking, handle drag) — potentially >100/sec. Batch the
  // redraw through the same RAF mechanism as the other overlays instead of
  // running it synchronously per event. redrawPathEdit is for the (mutually
  // exclusive) point-edit-mode overlay on a *committed* path, so it's skipped
  // entirely while a pen draft is in progress.
  const unsubPenTool = usePenToolStore.subscribe(() => {
    const flags = usePenToolStore.getState().isDrafting
      ? DIRTY_PEN_PREVIEW
      : DIRTY_PEN_PREVIEW | DIRTY_PATH_EDIT;
    scheduleOverlayRedraw(flags);
  });
  const unsubSelectionForPathEdit = useSelectionStore.subscribe(() => scheduleOverlayRedraw(DIRTY_PATH_EDIT));
  const unsubSceneForPathEdit = useSceneStore.subscribe(() => scheduleOverlayRedraw(DIRTY_PATH_EDIT));
  // Persistent guides are interactively dragged (like smart guides) — redraw
  // synchronously so the line tracks the pointer with zero added latency.
  const unsubPersistentGuides = useGuidesStore.subscribe(redrawPersistentGuides);
  // Non-interactive — batched via RAF
  const unsubPixelGrid = usePixelGridStore.subscribe(() => scheduleOverlayRedraw(DIRTY_GRID));
  const unsubUITheme = useUIThemeStore.subscribe(() => scheduleOverlayRedraw(DIRTY_GRID));
  // Viewport scale/pan changes — batch all overlays (cosmetic stroke-width corrections)
  const unsubViewport = useViewportStore.subscribe((state) => {
    const scaleChanged = state.scale !== lastViewport.scale;
    const panChanged = state.x !== lastViewport.x || state.y !== lastViewport.y;
    lastViewport = state;
    if (panChanged || scaleChanged) {
      scheduleOverlayRedraw(DIRTY_GRID | DIRTY_PERSISTENT_GUIDES);
    }
    if (scaleChanged) {
      scheduleOverlayRedraw(DIRTY_ALL_SCALE);
    }
  });

  // Initial draw
  redrawPixelGrid();
  redrawGuides();
  redrawPersistentGuides();
  redrawDropIndicator();
  redrawMeasureLines();
  redrawDrawPreview();
  redrawMarquee();
  redrawConnectorPreview();
  redrawPenPreview();
  redrawPathEdit();

  return () => {
    if (overlayRafId !== null) {
      cancelAnimationFrame(overlayRafId);
      overlayRafId = null;
    }
    unsubPixelGrid();
    unsubUITheme();
    unsubPersistentGuides();
    unsubGuides();
    unsubDrop();
    unsubMeasure();
    unsubDrawMode();
    unsubMarquee();
    unsubConnector();
    unsubDrawModeForPen();
    unsubPenTool();
    unsubSelectionForPathEdit();
    unsubSceneForPathEdit();
    unsubViewport();
    pixelGridGfx.destroy();
    guidesGfx.destroy();
    persistentGuidesGfx.destroy();
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
    connectorPreviewGfx.destroy();
    penPreviewGfx.destroy();
    pathEditGfx.destroy();
  };
}
