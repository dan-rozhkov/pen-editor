import { useState } from "react";
import clsx from "clsx";
import { useFpsCounter } from "@/hooks/useCanvasEffects";
import { useGuidesStore } from "@/store/guidesStore";

export function FpsDisplay() {
  const [fps, setFps] = useState<number | null>(null);
  const showRulers = useGuidesStore((s) => s.showRulers);
  useFpsCounter(setFps);

  if (!import.meta.env.DEV || fps === null) return null;
  return (
    <div
      className={clsx(
        "absolute z-10 select-none rounded bg-black/65 px-1.5 py-1 text-[11px] font-[system-ui,sans-serif] text-white pointer-events-auto",
        showRulers ? "top-7 left-7" : "top-3 left-3",
      )}
      title="FPS (dev only)"
    >
      {fps} fps
    </div>
  );
}
