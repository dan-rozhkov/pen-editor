import { useMemo, useRef } from "react";
import {
  useLayers3DStore,
  MIN_SPACING,
  MAX_SPACING,
} from "@/store/layers3dStore";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function Layers3DOverlay() {
  const active = useLayers3DStore((s) => s.active);
  const planes = useLayers3DStore((s) => s.planes);
  const rotateX = useLayers3DStore((s) => s.rotateX);
  const rotateY = useLayers3DStore((s) => s.rotateY);
  const spacing = useLayers3DStore((s) => s.spacing);
  const zoom = useLayers3DStore((s) => s.zoom);
  const hoveredPlaneId = useLayers3DStore((s) => s.hoveredPlaneId);
  const setRotation = useLayers3DStore((s) => s.setRotation);
  const setSpacing = useLayers3DStore((s) => s.setSpacing);
  const setZoom = useLayers3DStore((s) => s.setZoom);
  const setHovered = useLayers3DStore((s) => s.setHovered);
  const resetView = useLayers3DStore((s) => s.resetView);
  const exit = useLayers3DStore((s) => s.exit);

  const drag = useRef<{ x: number; y: number } | null>(null);
  const reducedMotion = useMemo(() => prefersReducedMotion(), []);

  if (!active) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-3d-controls]")) return;
    drag.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    setRotation(rotateX - dy * 0.3, rotateY + dx * 0.3);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{
        perspective: "1600px",
        background:
          "radial-gradient(circle at 50% 40%, var(--color-surface-elevated, #2a2a2a), var(--color-surface-panel, #1c1c1c))",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={(e) => setZoom(zoom - e.deltaY * 0.001)}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transformStyle: "preserve-3d",
          transform: `translate(-50%, -50%) scale(${zoom}) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
          transition: reducedMotion ? "none" : "transform 0.4s ease-out",
        }}
      >
        {planes.map((p) => {
          const isHovered = hoveredPlaneId === p.nodeId;
          const dimmed = hoveredPlaneId !== null && !isHovered;
          return (
            <img
              key={p.nodeId}
              data-plane-id={p.nodeId}
              src={p.imageUrl}
              alt=""
              onPointerEnter={() => setHovered(p.nodeId)}
              onPointerLeave={() => setHovered(null)}
              style={{
                position: "absolute",
                width: `${p.rect.width}px`,
                height: `${p.rect.height}px`,
                borderRadius: `${p.cornerRadius}px`,
                opacity: dimmed ? p.opacity * 0.5 : p.opacity,
                outline: isHovered ? "2px solid var(--color-accent-light)" : "none",
                boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
                transform: `translate3d(${p.rect.x}px, ${p.rect.y}px, ${
                  -p.depthIndex * spacing + (isHovered ? 20 : 0)
                }px)`,
              }}
            />
          );
        })}
      </div>

      <div
        data-3d-controls
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 rounded-lg bg-surface-panel px-4 py-2 shadow-lg"
      >
        <label className="flex items-center gap-2 text-sm text-text-muted">
          Spacing
          <input
            aria-label="Layer spacing"
            type="range"
            min={MIN_SPACING}
            max={MAX_SPACING}
            value={spacing}
            onChange={(e) => setSpacing(Number(e.target.value))}
          />
        </label>
        <button type="button" className="text-sm text-text-muted" onClick={resetView}>
          Reset view
        </button>
        <button type="button" className="text-sm text-text-muted" onClick={exit}>
          Exit
        </button>
      </div>
    </div>
  );
}
