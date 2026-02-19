import { useRef, useCallback } from "react";
import type { GradientColorStop } from "@/types/scene";
import { buildCSSGradient, interpolateColorAtPosition } from "@/utils/gradientUtils";

interface GradientBarProps {
  stops: GradientColorStop[];
  selectedIndex: number;
  onSelectStop: (index: number) => void;
  onMoveStop: (index: number, position: number) => void;
  onAddStop: (position: number, color: string) => void;
}

export function GradientBar({
  stops,
  selectedIndex,
  onSelectStop,
  onMoveStop,
  onAddStop,
}: GradientBarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<number | null>(null);

  const getPositionFromEvent = useCallback(
    (clientX: number): number => {
      if (!barRef.current) return 0;
      const rect = barRef.current.getBoundingClientRect();
      const x = clientX - rect.left;
      return Math.max(0, Math.min(1, x / rect.width));
    },
    [],
  );

  const handleMouseDown = useCallback(
    (index: number) => (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      onSelectStop(index);
      draggingRef.current = index;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (draggingRef.current === null) return;
        const pos = getPositionFromEvent(moveEvent.clientX);
        onMoveStop(draggingRef.current, Math.round(pos * 100) / 100);
      };

      const handleMouseUp = () => {
        draggingRef.current = null;
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [onSelectStop, onMoveStop, getPositionFromEvent],
  );

  const handleBarClick = useCallback(
    (e: React.MouseEvent) => {
      // Don't add a stop if we clicked on an existing marker
      if ((e.target as HTMLElement).dataset.stopMarker) return;
      const pos = getPositionFromEvent(e.clientX);
      const color = interpolateColorAtPosition(stops, pos);
      onAddStop(Math.round(pos * 100) / 100, color);
    },
    [stops, onAddStop, getPositionFromEvent],
  );

  const gradientCSS = buildCSSGradient(stops);

  return (
    <div
      ref={barRef}
      className="relative w-full h-6 rounded cursor-crosshair select-none"
      style={{ background: gradientCSS }}
      onClick={handleBarClick}
    >
      {/* Checkerboard background for transparency */}
      <div
        className="absolute inset-0 rounded -z-10"
        style={{
          backgroundImage:
            "repeating-conic-gradient(#d4d4d4 0% 25%, transparent 0% 50%)",
          backgroundSize: "8px 8px",
        }}
      />
      {stops.map((stop, index) => (
        <div
          key={index}
          data-stop-marker="true"
          className={`absolute top-0 w-2.5 h-full cursor-grab active:cursor-grabbing ${
            index === selectedIndex
              ? "ring-2 ring-[var(--color-accent-light)] z-10"
              : "ring-1 ring-white/60"
          }`}
          style={{
            left: `clamp(0px, calc(${stop.position * 100}% - 5px), calc(100% - 10px))`,
            backgroundColor: stop.color,
            borderRadius: 2,
          }}
          onMouseDown={handleMouseDown(index)}
        />
      ))}
    </div>
  );
}
