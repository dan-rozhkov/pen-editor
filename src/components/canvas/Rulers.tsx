import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { useViewportStore } from "@/store/viewportStore";
import { useGuidesStore } from "@/store/guidesStore";
import { useUIThemeStore } from "@/store/uiThemeStore";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useHistoryStore } from "@/store/historyStore";

export const RULER_SIZE = 20;
const GUIDE_HIT_SIZE = 6;

interface CreatingGuide {
  orientation: "horizontal" | "vertical";
  screenPos: number;
}

/** The Pixi canvas fills the whole window behind the floating UI panels, so
 * viewportStore's pan (x/y) is calibrated against *that* element's top-left —
 * not this component's, which sits in the flex-laid-out visible strip between
 * the side panels. Every conversion below goes through this element's rect. */
function getPixiCanvasRect(): DOMRect | null {
  const canvas = useCanvasRefStore.getState().pixiRefs?.app.canvas as
    | HTMLCanvasElement
    | undefined;
  return canvas ? canvas.getBoundingClientRect() : null;
}

/**
 * Rulers along the top/left edges of the visible canvas area (toggle:
 * Shift+R) plus the persistent draggable guides they spawn. Rulers/tick
 * labels are a plain 2D canvas overlay (screen-space, redrawn from
 * viewportStore); the guide lines themselves are rendered in world-space by
 * OverlayRenderer/Pixi so they pan and zoom with the scene. This component
 * only owns interaction: dragging a guide out of a ruler creates it,
 * dragging an existing guide moves it, and dropping it back onto its ruler
 * deletes it.
 */
export function Rulers() {
  const showRulers = useGuidesStore((s) => s.showRulers);
  const guides = useGuidesStore((s) => s.guides);
  const addGuide = useGuidesStore((s) => s.addGuide);
  const removeGuide = useGuidesStore((s) => s.removeGuide);
  const updateGuidePosition = useGuidesStore((s) => s.updateGuidePosition);
  const uiTheme = useUIThemeStore((s) => s.uiTheme);
  const hasPixiCanvas = useCanvasRefStore((s) => Boolean(s.pixiRefs?.app.canvas));

  const rootRef = useRef<HTMLDivElement | null>(null);
  const topCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [creatingGuide, setCreatingGuide] = useState<CreatingGuide | null>(null);
  const draggingGuideId = useRef<string | null>(null);

  // Invisible hit-sensor DOM nodes for each guide, keyed by guide id. Positioned
  // imperatively (see the layout effect below) rather than via React state so a
  // pan/zoom doesn't re-render this component every animation frame — the
  // visible guide line is drawn by Pixi; these sensors only need their local
  // offset nudged to keep tracking it.
  const sensorRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Track this component's own (flex-sized) box — it changes whenever a side
  // panel is toggled/resized, not just on window resize.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: root.clientWidth, height: root.clientHeight });
    });
    observer.observe(root);
    setSize({ width: root.clientWidth, height: root.clientHeight });
    return () => observer.disconnect();
  }, []);

  // World <-> local-screen conversions. "Local" means relative to this
  // component's own root (what pointer handlers measure), which is offset
  // from the Pixi canvas's origin by however wide the left panel currently is.
  const worldToLocal = useCallback((worldPos: number, axis: "x" | "y"): number => {
    const vs = useViewportStore.getState();
    const canvasRect = getPixiCanvasRect();
    const rootRect = rootRef.current?.getBoundingClientRect();
    if (!canvasRect || !rootRect) return 0;
    const offset = axis === "x" ? canvasRect.left - rootRect.left : canvasRect.top - rootRect.top;
    return axis === "x"
      ? worldPos * vs.scale + vs.x + offset
      : worldPos * vs.scale + vs.y + offset;
  }, []);

  const localToWorld = useCallback((localPos: number, axis: "x" | "y"): number => {
    const vs = useViewportStore.getState();
    const canvasRect = getPixiCanvasRect();
    const rootRect = rootRef.current?.getBoundingClientRect();
    if (!canvasRect || !rootRect) return 0;
    const offset = axis === "x" ? rootRect.left - canvasRect.left : rootRect.top - canvasRect.top;
    return axis === "x"
      ? (localPos + offset - vs.x) / vs.scale
      : (localPos + offset - vs.y) / vs.scale;
  }, []);

  // Draw tick marks + labels on the ruler canvases whenever the viewport,
  // theme, or size changes.
  useEffect(() => {
    if (!showRulers) return;

    const isDark = uiTheme === "dark";
    const bg = isDark ? "#2b2b2b" : "#ffffff";
    const tickColor = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)";
    const labelColor = isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";

    function niceStep(scale: number, minPxGap: number): number {
      const worldGap = minPxGap / scale;
      const pow = Math.pow(10, Math.floor(Math.log10(worldGap)));
      for (const c of [1, 2, 5, 10]) {
        if (pow * c >= worldGap) return pow * c;
      }
      return pow * 10;
    }

    // Draw one ruler strip. axis "x" = the top (horizontal) ruler, "y" = the
    // left (vertical) ruler; the two differ only by which dimension spans and
    // whether the tick labels are upright or rotated.
    function drawRuler(
      canvas: HTMLCanvasElement | null,
      axis: "x" | "y",
      sizePx: number,
      pan: number,
      offset: number,
      scale: number,
      step: number,
      dpr: number,
    ): void {
      if (!canvas) return;
      const isVertical = axis === "y";
      const span = Math.max(0, sizePx - RULER_SIZE);
      canvas.width = (isVertical ? RULER_SIZE : span) * dpr;
      canvas.height = (isVertical ? span : RULER_SIZE) * dpr;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, isVertical ? RULER_SIZE : span, isVertical ? span : RULER_SIZE);
      const worldMin = (RULER_SIZE + offset - pan) / scale;
      const worldMax = (RULER_SIZE + span + offset - pan) / scale;
      const start = Math.floor(worldMin / step) * step;
      ctx.font = "9px system-ui, sans-serif";
      ctx.fillStyle = labelColor;
      ctx.strokeStyle = tickColor;
      ctx.lineWidth = 1;
      ctx.textBaseline = "top";
      for (let w = start; w <= worldMax; w += step) {
        const s = w * scale + pan - offset - RULER_SIZE;
        ctx.beginPath();
        if (isVertical) {
          ctx.moveTo(RULER_SIZE - 6, s + 0.5);
          ctx.lineTo(RULER_SIZE, s + 0.5);
          ctx.stroke();
          ctx.save();
          ctx.translate(RULER_SIZE * 0.5, s);
          ctx.rotate(-Math.PI / 2);
          ctx.textAlign = "center";
          ctx.fillText(String(Math.round(w)), 0, -8);
          ctx.restore();
        } else {
          ctx.moveTo(s + 0.5, RULER_SIZE - 6);
          ctx.lineTo(s + 0.5, RULER_SIZE);
          ctx.stroke();
          ctx.textAlign = "center";
          ctx.fillText(String(Math.round(w)), s, 1);
        }
      }
    }

    function draw(): void {
      const vs = useViewportStore.getState();
      const canvasRect = getPixiCanvasRect();
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (!canvasRect || !rootRect) return;
      const dpr = window.devicePixelRatio || 1;
      const step = niceStep(vs.scale, 50);
      const offsetX = rootRect.left - canvasRect.left;
      const offsetY = rootRect.top - canvasRect.top;

      drawRuler(topCanvasRef.current, "x", size.width, vs.x, offsetX, vs.scale, step, dpr);
      drawRuler(leftCanvasRef.current, "y", size.height, vs.y, offsetY, vs.scale, step, dpr);
    }

    draw();
    const unsubscribe = useViewportStore.subscribe(draw);
    return () => unsubscribe();
  }, [showRulers, uiTheme, size, hasPixiCanvas]);

  // Position the guide hit-sensors imperatively (no setState → no per-frame
  // re-render) and keep them tracking viewport pan/zoom. useLayoutEffect so a
  // freshly-mounted sensor is placed before paint (guides only change on
  // add/remove/move, not on pan).
  const layoutSensors = useCallback((): void => {
    for (const guide of guides) {
      const el = sensorRefs.current.get(guide.id);
      if (!el) continue;
      const screenPos = worldToLocal(
        guide.position,
        guide.orientation === "vertical" ? "x" : "y",
      );
      if (guide.orientation === "vertical") {
        el.style.left = `${screenPos - GUIDE_HIT_SIZE / 2}px`;
      } else {
        el.style.top = `${screenPos - GUIDE_HIT_SIZE / 2}px`;
      }
    }
  }, [guides, worldToLocal]);

  useLayoutEffect(() => {
    layoutSensors();
    const unsubscribe = useViewportStore.subscribe(layoutSensors);
    return () => unsubscribe();
  }, [guides, size, layoutSensors]);

  const handleCreateGuidePointerDown = useCallback(
    (orientation: "horizontal" | "vertical") =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const rootRect = rootRef.current?.getBoundingClientRect();
        if (!rootRect) return;
        const screenPos =
          orientation === "horizontal"
            ? e.clientY - rootRect.top
            : e.clientX - rootRect.left;
        setCreatingGuide({ orientation, screenPos });

        const onMove = (ev: PointerEvent): void => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) return;
          setCreatingGuide({
            orientation,
            screenPos:
              orientation === "horizontal" ? ev.clientY - rect.top : ev.clientX - rect.left,
          });
        };
        const onUp = (ev: PointerEvent): void => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          setCreatingGuide(null);
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) return;
          const localX = ev.clientX - rect.left;
          const localY = ev.clientY - rect.top;
          // Dropped back onto this guide's own ruler — no-op. Only gate on
          // the axis the guide belongs to (a vertical guide shouldn't be
          // cancelled just because it's hovering over the horizontal ruler).
          const droppedOnOwnRuler = orientation === "horizontal" ? localY < RULER_SIZE : localX < RULER_SIZE;
          if (droppedOnOwnRuler) return;
          const worldPos = localToWorld(
            orientation === "horizontal" ? localY : localX,
            orientation === "horizontal" ? "y" : "x",
          );
          // Snapshot the pre-mutation state (guides not yet changed by this
          // gesture) so a single undo removes the newly created guide.
          useHistoryStore.getState().saveHistory(createSnapshot(useSceneStore.getState()));
          addGuide(orientation, Math.round(worldPos));
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
    [addGuide, localToWorld],
  );

  const handleGuidePointerDown = useCallback(
    (id: string, orientation: "horizontal" | "vertical") =>
      (e: React.PointerEvent<HTMLDivElement>) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        draggingGuideId.current = id;

        // Snapshot before this gesture mutates anything, so a single undo
        // reverts the whole move (or move+delete) as one step. Saved lazily
        // at gesture end (not on every pointermove) but captures the
        // pre-drag guide positions since it's built now.
        const preDragSnapshot = createSnapshot(useSceneStore.getState());
        let moved = false;

        const onMove = (ev: PointerEvent): void => {
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect || draggingGuideId.current !== id) return;
          const localPos =
            orientation === "horizontal" ? ev.clientY - rect.top : ev.clientX - rect.left;
          const worldPos = localToWorld(localPos, orientation === "horizontal" ? "y" : "x");
          moved = true;
          updateGuidePosition(id, Math.round(worldPos));
        };
        const onUp = (ev: PointerEvent): void => {
          window.removeEventListener("pointermove", onMove);
          window.removeEventListener("pointerup", onUp);
          draggingGuideId.current = null;
          const rect = rootRef.current?.getBoundingClientRect();
          if (!rect) return;
          const localX = ev.clientX - rect.left;
          const localY = ev.clientY - rect.top;
          const droppedOnRuler =
            orientation === "horizontal" ? localY < RULER_SIZE : localX < RULER_SIZE;
          if (droppedOnRuler) {
            useHistoryStore.getState().saveHistory(preDragSnapshot);
            removeGuide(id);
          } else if (moved) {
            useHistoryStore.getState().saveHistory(preDragSnapshot);
          }
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      },
    [localToWorld, removeGuide, updateGuidePosition],
  );

  return (
    <div ref={rootRef} className="absolute inset-0 pointer-events-none" data-rulers-root>
      {showRulers && (
        <>
          <div
            className="absolute top-0 z-20 pointer-events-auto cursor-row-resize"
            style={{ left: RULER_SIZE, height: RULER_SIZE, right: 0 }}
            onPointerDown={handleCreateGuidePointerDown("horizontal")}
            title="Drag to create a horizontal guide"
          >
            <canvas ref={topCanvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
          </div>
          <div
            className="absolute left-0 z-20 pointer-events-auto cursor-col-resize"
            style={{ top: RULER_SIZE, width: RULER_SIZE, bottom: 0 }}
            onPointerDown={handleCreateGuidePointerDown("vertical")}
            title="Drag to create a vertical guide"
          >
            <canvas ref={leftCanvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
          </div>
          <div
            className="absolute top-0 left-0 z-20 bg-surface-panel"
            style={{
              width: RULER_SIZE,
              height: RULER_SIZE,
            }}
          />
        </>
      )}

      {/* Preview line while dragging a new guide out from a ruler */}
      {creatingGuide && (
        <div
          className="absolute bg-[#ff3366]/70 pointer-events-none z-20"
          style={
            creatingGuide.orientation === "horizontal"
              ? { left: 0, right: 0, top: creatingGuide.screenPos, height: 1 }
              : { top: 0, bottom: 0, left: creatingGuide.screenPos, width: 1 }
          }
        />
      )}

      {/* Invisible drag/delete sensors for existing persistent guides — kept
          interactive even when the rulers themselves are hidden. */}
      {guides.map((guide) => (
        <div
          key={guide.id}
          ref={(el) => {
            if (el) sensorRefs.current.set(guide.id, el);
            else sensorRefs.current.delete(guide.id);
          }}
          className={
            "absolute pointer-events-auto z-10 " +
            (guide.orientation === "vertical" ? "cursor-col-resize" : "cursor-row-resize")
          }
          // The cross-axis extents are static; the along-axis offset (left for
          // vertical, top for horizontal) is set imperatively by layoutSensors.
          style={
            guide.orientation === "vertical"
              ? { top: 0, bottom: 0, width: GUIDE_HIT_SIZE }
              : { left: 0, right: 0, height: GUIDE_HIT_SIZE }
          }
          onPointerDown={handleGuidePointerDown(guide.id, guide.orientation)}
          title="Drag to move, drop on ruler to delete"
        />
      ))}
    </div>
  );
}
