import { Container, Graphics, Text } from "pixi.js";
import { useSmartGuideStore } from "@/store/smartGuideStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useDragStore } from "@/store/dragStore";
import { useMeasureStore, type MeasureLine } from "@/store/measureStore";
import { useMeasurementsStore } from "@/store/measurementsStore";
import { useDevModeStore } from "@/store/devModeStore";
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
import { isDescendantOfFlat } from "@/utils/nodeUtils";
import { computeMeasurementLines, measureLineEndpoints } from "@/utils/measureUtils";
import { formatMeasureLine } from "@/lib/inspect/units";
import { getMarqueeRect, subscribeOverlayState } from "./pixiOverlayState";
import { createOverlayHelpers } from "./selectionOverlay/helpers";
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
  sceneRoot: Container,
  getViewportSize: () => { width: number; height: number },
): () => void {
  const overlayHelpers = createOverlayHelpers(sceneRoot);
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

  // Persistent (pinned) measurements — Task 8's Dev Mode measure tool
  // (Shift+M). Distinct from `measureGfx`/`measureLabels` above, which
  // render the ephemeral hover/drag preview from `useMeasureStore`.
  const persistentMeasureGfx = new Graphics();
  persistentMeasureGfx.label = "persistent-measurements";
  overlayContainer.addChild(persistentMeasureGfx);

  const persistentMeasureLabels = new Container();
  persistentMeasureLabels.label = "persistent-measurement-labels";
  measureLabelContainer.addChild(persistentMeasureLabels);

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

  /** Pooled floating labels for a measure-line layer — avoids per-frame Text/Graphics churn. */
  function createMeasureLabelPool(container: Container) {
    const pool: MeasureLabelEntry[] = [];
    const active: MeasureLabelEntry[] = [];

    function acquire(): MeasureLabelEntry {
      const entry =
        pool.pop() ??
        (() => {
          const group = new Container();
          const bg = new Graphics();
          const text = new Text({ text: "", style: FLOATING_LABEL_STYLE });
          group.addChild(bg);
          group.addChild(text);
          return { group, bg, text };
        })();
      container.addChild(entry.group);
      active.push(entry);
      return entry;
    }

    function recycleAll(): void {
      while (active.length > 0) {
        const entry = active.pop();
        if (!entry) break;
        container.removeChild(entry.group);
        pool.push(entry);
      }
    }

    function destroy(): void {
      recycleAll();
      while (pool.length > 0) {
        const entry = pool.pop();
        if (!entry) break;
        entry.group.destroy({ children: true });
      }
      container.destroy({ children: true });
    }

    return { acquire, recycleAll, destroy };
  }

  /** Draw one measure line's main segment + end caps into `gfx`. Returns its screen-space endpoints. */
  function drawMeasureLineSegment(
    gfx: Graphics,
    line: MeasureLine,
    color: number,
    strokeWidth: number,
    capSize: number,
  ): { x1: number; y1: number; x2: number; y2: number } {
    const { x1, y1, x2, y2 } = measureLineEndpoints(line);

    gfx.moveTo(x1, y1);
    gfx.lineTo(x2, y2);
    if (line.orientation === "horizontal") {
      gfx.moveTo(x1, y1 - capSize);
      gfx.lineTo(x1, y1 + capSize);
      gfx.moveTo(x2, y2 - capSize);
      gfx.lineTo(x2, y2 + capSize);
    } else {
      gfx.moveTo(x1 - capSize, y1);
      gfx.lineTo(x1 + capSize, y1);
      gfx.moveTo(x2 - capSize, y2);
      gfx.lineTo(x2 + capSize, y2);
    }
    gfx.stroke({ color, width: strokeWidth });

    return { x1, y1, x2, y2 };
  }

  /** Paint a pooled label entry centered on a line's midpoint, screen-size fixed via inverse scaling. */
  function paintMeasureLabel(
    entry: MeasureLabelEntry,
    label: string,
    color: number,
    invScale: number,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ): void {
    entry.group.position.set((x1 + x2) / 2, (y1 + y2) / 2);
    entry.group.scale.set(invScale);
    entry.text.text = label;
    const bgWidth = entry.text.width + FLOATING_LABEL_PADDING_X * 2;
    const bgHeight = FLOATING_LABEL_FONT_SIZE + FLOATING_LABEL_PADDING_Y * 2;
    entry.bg.clear();
    entry.bg.roundRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight, FLOATING_LABEL_RADIUS);
    entry.bg.fill(color);
    entry.text.position.set(-entry.text.width / 2, -bgHeight / 2 + FLOATING_LABEL_PADDING_Y);
  }

  const measureLabelPool = createMeasureLabelPool(measureLabels);
  const persistentMeasureLabelPool = createMeasureLabelPool(persistentMeasureLabels);
  let lastViewport = useViewportStore.getState();

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
    measureLabelPool.recycleAll();

    const { lines } = useMeasureStore.getState();
    if (lines.length === 0) return;

    const scale = useViewportStore.getState().scale;
    const invScale = 1 / scale;
    const strokeWidth = invScale;
    const capSize = 4 * invScale;

    for (const line of lines) {
      const { x1, y1, x2, y2 } = drawMeasureLineSegment(measureGfx, line, MEASURE_COLOR, strokeWidth, capSize);
      const entry = measureLabelPool.acquire();
      paintMeasureLabel(entry, line.label, MEASURE_COLOR, invScale, x1, y1, x2, y2);
    }
  }

  /**
   * Persistent (pinned) measurements — Task 8's Dev Mode measure tool.
   * Read-only overlay, active only while dev mode is on: for each stored
   * `{fromId,toId}` pair, resolve both nodes' current draw rects and pick
   * parent/child (padding) vs sibling (gap) geometry from their ancestry,
   * then draw ALL resulting lines. Measurements whose nodes no longer
   * resolve are skipped rather than crashing (e.g. a deleted node whose
   * `removeMeasurementsForNodes` cleanup hasn't landed yet).
   */
  function redrawPersistentMeasurements(): void {
    persistentMeasureGfx.clear();
    persistentMeasureLabelPool.recycleAll();

    const devMode = useDevModeStore.getState();
    if (!devMode.active) return;

    const { measurements, selectedMeasurementId } = useMeasurementsStore.getState();
    if (measurements.length === 0) return;

    const scale = useViewportStore.getState().scale;
    const invScale = 1 / scale;
    const capSize = 4 * invScale;
    const parentById = useSceneStore.getState().parentById;

    for (const m of measurements) {
      const fromRect = overlayHelpers.getNodeDrawRect(m.fromId);
      const toRect = overlayHelpers.getNodeDrawRect(m.toId);
      if (!fromRect || !toRect) continue;

      const relation = isDescendantOfFlat(parentById, m.fromId, m.toId)
        ? "from-is-ancestor"
        : isDescendantOfFlat(parentById, m.toId, m.fromId)
          ? "to-is-ancestor"
          : "sibling";
      const lines = computeMeasurementLines(fromRect, toRect, relation);
      const isSelected = m.id === selectedMeasurementId;
      const strokeWidth = (isSelected ? 2 : 1) * invScale;

      for (const line of lines) {
        const formatted = formatMeasureLine(line, devMode.units, devMode.remBase);
        const { x1, y1, x2, y2 } = drawMeasureLineSegment(
          persistentMeasureGfx,
          formatted,
          MEASURE_COLOR,
          strokeWidth,
          capSize,
        );
        const entry = persistentMeasureLabelPool.acquire();
        paintMeasureLabel(entry, formatted.label, MEASURE_COLOR, invScale, x1, y1, x2, y2);
      }
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
  const DIRTY_PERSISTENT_MEASURE = 1024;
  const DIRTY_ALL_SCALE =
    DIRTY_GUIDES | DIRTY_DROP | DIRTY_MEASURE | DIRTY_DRAW | DIRTY_MARQUEE | DIRTY_CONNECTOR |
    DIRTY_PERSISTENT_GUIDES | DIRTY_PERSISTENT_MEASURE;
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
    if (flags & DIRTY_PERSISTENT_MEASURE) redrawPersistentMeasurements();
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
  const unsubSceneForPathEdit = useSceneStore.subscribe(() =>
    scheduleOverlayRedraw(DIRTY_PATH_EDIT | DIRTY_PERSISTENT_MEASURE),
  );
  // Persistent measurements: redraw when the pinned set/selection changes, or
  // when dev mode toggles (the layer only renders while active). Node
  // position/size changes already reschedule via the sceneStore subscription
  // above (`DIRTY_PATH_EDIT | DIRTY_PERSISTENT_MEASURE`).
  const unsubMeasurements = useMeasurementsStore.subscribe(() =>
    scheduleOverlayRedraw(DIRTY_PERSISTENT_MEASURE),
  );
  const unsubDevMode = useDevModeStore.subscribe(() => scheduleOverlayRedraw(DIRTY_PERSISTENT_MEASURE));
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
  redrawPersistentMeasurements();

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
    unsubMeasurements();
    unsubDevMode();
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
    measureLabelPool.destroy();
    persistentMeasureGfx.destroy();
    persistentMeasureLabelPool.destroy();
    drawPreviewGfx.destroy();
    marqueeGfx.destroy();
    connectorPreviewGfx.destroy();
    penPreviewGfx.destroy();
    pathEditGfx.destroy();
  };
}
