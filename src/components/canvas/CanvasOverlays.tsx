import { useState } from "react";
import { useFpsCounter } from "@/hooks/useCanvasEffects";
import { useViewportStore } from "@/store/viewportStore";
import { useSceneStore } from "@/store/sceneStore";

export function ZoomIndicator() {
  const scale = useViewportStore((s) => s.scale);
  const fitToContent = useViewportStore((s) => s.fitToContent);
  const handleFitToContent = () => {
    const nodes = useSceneStore.getState().getNodes();
    fitToContent(nodes, window.innerWidth, window.innerHeight);
  };

  return (
    <div
      onClick={handleFitToContent}
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
