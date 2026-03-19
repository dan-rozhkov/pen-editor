import { useState } from "react";
import { useFpsCounter } from "@/hooks/useCanvasEffects";

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
