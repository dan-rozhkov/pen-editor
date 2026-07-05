import { useEffect, useRef, useState, useCallback } from "react";
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

  const rootRef = useRef<HTMLDivElement | null>(null);
  const topCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const leftCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const [creatingGuide, setCreatingGuide] = useState<CreatingGuide | null>(null);
  const draggingGuideId = useRef<string | null>(null);

  // Local-screen positions for each guide's invisible hit sensor, keyed by
  // guide id. Kept in state (not computed during render) so we never read refs
  // mid-render, and recomputed on viewport/size changes so the sensors track
  // pan/zoom like the ruler ticks do.
  const [guidePositions, setGuidePositions] = useState<Record<string, number>>({});

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

    function draw(): void {
      const vs = useViewportStore.getState();
      const canvasRect = getPixiCanvasRect();
      const rootRect = rootRef.current?.getBoundingClientRect();
      if (!canvasRect || !rootRect) return;
      const dpr = window.devicePixelRatio || 1;
      const step = niceStep(vs.scale, 50);
      const offsetX = rootRect.left - canvasRect.left;
      const offsetY = rootRect.top - canvasRect.top;

      const topCanvas = topCanvasRef.current;
      if (topCanvas) {
        const w = Math.max(0, size.width - RULER_SIZE);
        topCanvas.width = w * dpr;
        topCanvas.height = RULER_SIZE * dpr;
        const ctx = topCanvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, RULER_SIZE);
          const worldMin = (RULER_SIZE + offsetX - vs.x) / vs.scale;
          const worldMax = (RULER_SIZE + w + offsetX - vs.x) / vs.scale;
          const start = Math.floor(worldMin / step) * step;
          ctx.font = "9px system-ui, sans-serif";
          ctx.fillStyle = labelColor;
          ctx.strokeStyle = tickColor;
          ctx.lineWidth = 1;
          for (let wx = start; wx <= worldMax; wx += step) {
            const sx = wx * vs.scale + vs.x - offsetX - RULER_SIZE;
            ctx.beginPath();
            ctx.moveTo(sx + 0.5, RULER_SIZE * 0.4);
            ctx.lineTo(sx + 0.5, RULER_SIZE);
            ctx.stroke();
            ctx.fillText(String(Math.round(wx)), sx + 2, RULER_SIZE * 0.6);
          }
        }
      }

      const leftCanvas = leftCanvasRef.current;
      if (leftCanvas) {
        const h = Math.max(0, size.height - RULER_SIZE);
        leftCanvas.width = RULER_SIZE * dpr;
        leftCanvas.height = h * dpr;
        const ctx = leftCanvas.getContext("2d");
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, RULER_SIZE, h);
          const worldMin = (RULER_SIZE + offsetY - vs.y) / vs.scale;
          const worldMax = (RULER_SIZE + h + offsetY - vs.y) / vs.scale;
          const start = Math.floor(worldMin / step) * step;
          ctx.font = "9px system-ui, sans-serif";
          ctx.fillStyle = labelColor;
          ctx.strokeStyle = tickColor;
          ctx.lineWidth = 1;
          for (let wy = start; wy <= worldMax; wy += step) {
            const sy = wy * vs.scale + vs.y - offsetY - RULER_SIZE;
            ctx.beginPath();
            ctx.moveTo(RULER_SIZE * 0.4, sy + 0.5);
            ctx.lineTo(RULER_SIZE, sy + 0.5);
            ctx.stroke();
            ctx.save();
            ctx.translate(RULER_SIZE * 0.6, sy - 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Math.round(wy)), 0, 0);
            ctx.restore();
          }
        }
      }
    }

    draw();
    const unsubscribe = useViewportStore.subscribe(draw);
    return () => unsubscribe();
  }, [showRulers, uiTheme, size]);

  // Recompute guide hit-sensor screen positions off-render (refs are only read
  // here, never during render) and keep them in sync with viewport pan/zoom.
  useEffect(() => {
    const recompute = (): void => {
      const next: Record<string, number> = {};
      for (const guide of guides) {
        next[guide.id] = worldToLocal(
          guide.position,
          guide.orientation === "vertical" ? "x" : "y",
        );
      }
      setGuidePositions(next);
    };
    recompute();
    const unsubscribe = useViewportStore.subscribe(recompute);
    return () => unsubscribe();
  }, [guides, size, worldToLocal]);

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
          className="absolute bg-blue-500/70 pointer-events-none z-20"
          style={
            creatingGuide.orientation === "horizontal"
              ? { left: 0, right: 0, top: creatingGuide.screenPos, height: 1 }
              : { top: 0, bottom: 0, left: creatingGuide.screenPos, width: 1 }
          }
        />
      )}

      {/* Invisible drag/delete sensors for existing persistent guides — kept
          interactive even when the rulers themselves are hidden. */}
      {guides.map((guide) => {
        const screenPos = guidePositions[guide.id] ?? 0;
        return (
          <div
            key={guide.id}
            className={
              "absolute pointer-events-auto z-10 " +
              (guide.orientation === "vertical" ? "cursor-col-resize" : "cursor-row-resize")
            }
            style={
              guide.orientation === "vertical"
                ? { left: screenPos - GUIDE_HIT_SIZE / 2, top: 0, bottom: 0, width: GUIDE_HIT_SIZE }
                : { top: screenPos - GUIDE_HIT_SIZE / 2, left: 0, right: 0, height: GUIDE_HIT_SIZE }
            }
            onPointerDown={handleGuidePointerDown(guide.id, guide.orientation)}
            title="Drag to move, drop on ruler to delete"
          />
        );
      })}
    </div>
  );
}
