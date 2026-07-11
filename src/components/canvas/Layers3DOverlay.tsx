import {
  ArrowCounterClockwiseIcon,
  CircleNotch,
  XIcon,
} from "@phosphor-icons/react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useLayers3DStore,
  MIN_SPACING,
  MAX_SPACING,
} from "@/store/layers3dStore";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { IconButton } from "@/components/ui/IconButton";

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
  const isLoading = useLayers3DStore((s) => s.isLoading);
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

  // Bounding box of all plane rects (children can sit at negative offsets
  // relative to the frame origin). Positioning planes relative to this bbox and
  // giving the wrapper the bbox's intrinsic size lets translate(-50%,-50%)
  // center the true bounds rather than the frame's top-left corner.
  const bbox = useMemo(() => {
    if (planes.length === 0) return { minX: 0, minY: 0, width: 0, height: 0 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of planes) {
      minX = Math.min(minX, p.rect.x);
      minY = Math.min(minY, p.rect.y);
      maxX = Math.max(maxX, p.rect.x + p.rect.width);
      maxY = Math.max(maxY, p.rect.y + p.rect.height);
    }
    return { minX, minY, width: maxX - minX, height: maxY - minY };
  }, [planes]);

  const maxDepth = useMemo(
    () => Math.max(0, ...planes.map((p) => p.depth)),
    [planes],
  );

  // Measure the overlay container so the stack can be scaled to fit on entry.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [container, setContainer] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setContainer({ w: r.width, h: r.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [active]);

  // Fit-to-viewport scale (never upscales past 1). Guards degenerate bboxes and
  // unmeasured containers (happy-dom / pre-layout) by falling back to 1.
  const baseScale = useMemo(() => {
    const candidates = [1];
    if (container.w > 0 && bbox.width > 0) {
      candidates.push((0.8 * container.w) / bbox.width);
    }
    if (container.h > 0 && bbox.height > 0) {
      candidates.push((0.8 * container.h) / bbox.height);
    }
    return Math.min(...candidates);
  }, [container.w, container.h, bbox.width, bbox.height]);

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
    const { rotateX: liveRotateX, rotateY: liveRotateY } =
      useLayers3DStore.getState();
    setRotation(liveRotateX - dy * 0.3, liveRotateY + dx * 0.3);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  return (
    <div
      ref={containerRef}
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
      onWheel={(e) => {
        const { zoom: liveZoom } = useLayers3DStore.getState();
        setZoom(liveZoom - e.deltaY * 0.003);
      }}
    >
      <div
        data-3d-stack
        className="absolute left-1/2 top-1/2"
        style={{
          width: `${bbox.width}px`,
          height: `${bbox.height}px`,
          transformStyle: "preserve-3d",
          transform: `translate(-50%, -50%) scale(${zoom * baseScale}) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
          transition: reducedMotion ? "none" : "transform 0.12s linear",
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
                // The stack is absolutely positioned with no intrinsic width,
                // so Tailwind preflight's `img { max-width: 100% }` would clamp
                // every plane to 0px. Opt out so the explicit px size wins.
                maxWidth: "none",
                maxHeight: "none",
                borderRadius: `${p.cornerRadius}px`,
                opacity: dimmed ? 0.5 : 1,
                outline: isHovered
                  ? "2px solid rgba(125, 196, 255, 0.95)"
                  : "1px solid rgba(125, 196, 255, 0.5)",
                // depth is the node's distance from the exploded frame root
                // (root frame = 0, each level of nesting +1). Deeper
                // descendants must sit CLOSER to the viewer (larger +Z), so the
                // root frame is at the back. Offset by the max depth's
                // midpoint to keep the stack centered in the perspective
                // container. Sibling nodes share the same depth and render
                // coplanar.
                transform: `translate3d(${p.rect.x - bbox.minX}px, ${
                  p.rect.y - bbox.minY
                }px, ${
                  (p.depth - maxDepth / 2) * spacing
                }px)`,
              }}
            />
          );
        })}
      </div>
      {isLoading && (
        <div
          data-3d-loading
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <CircleNotch
            size={28}
            weight="thin"
            className="text-text-muted"
            style={{ animation: "spin 1s linear infinite" }}
          />
        </div>
      )}

      <div
        data-3d-controls
        className="absolute bottom-4 left-1/2 -translate-x-1/2"
      >
        <div className="flex items-center gap-1 rounded-2xl border border-border-default bg-surface-panel p-1.5 shadow-[0_0px_3px_rgba(0,0,0,0.04)]">
          <Label className="gap-2 px-2 text-text-primary">
            <span>Spacing</span>
            <Slider
              className="w-28"
              getAriaLabel={() => "Layer spacing"}
              min={MIN_SPACING}
              max={MAX_SPACING}
              value={spacing}
              onValueChange={(next) =>
                setSpacing(Array.isArray(next) ? next[0] ?? MIN_SPACING : next)
              }
            />
          </Label>
          <Separator orientation="vertical" className="my-1" />
          <IconButton
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={resetView}
            tooltip="Reset view"
            side="top"
            aria-label="Reset 3D view"
          >
            <ArrowCounterClockwiseIcon size={24} weight="light" />
          </IconButton>
          <IconButton
            type="button"
            variant="ghost"
            size="icon-lg"
            onClick={exit}
            tooltip="Exit"
            shortcut="Esc"
            side="top"
            aria-label="Exit 3D view"
          >
            <XIcon size={24} weight="light" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}
