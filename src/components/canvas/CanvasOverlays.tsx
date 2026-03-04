import { useState } from "react";
import { useFpsCounter } from "@/hooks/useCanvasEffects";

interface ZoomIndicatorProps {
  scale: number;
  onFitToContent: () => void;
}

export function ZoomIndicator({ scale, onFitToContent }: ZoomIndicatorProps) {
  return (
    <div
      onClick={onFitToContent}
      className="absolute bottom-3 left-3 z-10 cursor-pointer select-none rounded bg-surface-panel/90 px-2 py-1 text-xs text-text-muted pointer-events-auto"
      title="Click to fit all (Cmd/Ctrl+0)"
    >
      {Math.round(scale * 100)}%
    </div>
  );
}

export function FpsDisplay() {
  const [fps, setFps] = useState<number | null>(null);
  useFpsCounter(setFps);

  if (!import.meta.env.DEV || fps === null) return null;
  return (
    <div
      className="absolute top-3 left-3 z-10 select-none rounded bg-black/65 px-1.5 py-1 text-[11px] font-[system-ui,sans-serif] text-white pointer-events-auto"
      title="FPS (dev only)"
    >
      {fps} fps
    </div>
  );
}
