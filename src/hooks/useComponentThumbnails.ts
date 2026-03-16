import { useEffect, useRef, useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { findPixiChild } from "@/utils/pixiUtils";
import type { FlatFrameNode } from "@/types/scene";

export function useComponentThumbnails(components: FlatFrameNode[]) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (!pixiRefs || components.length === 0) {
      setThumbnails(new Map());
      return;
    }

    timeoutRef.current = setTimeout(async () => {
      const { app, sceneRoot } = pixiRefs;
      const map = new Map<string, string>();

      for (const comp of components) {
        const container = findPixiChild(sceneRoot, comp.id);
        if (!container) continue;
        try {
          const raw = await app.renderer.extract.base64(container);
          // raw may or may not include the data URI prefix
          const dataUrl = raw.startsWith("data:")
            ? raw
            : `data:image/png;base64,${raw}`;
          map.set(comp.id, dataUrl);
        } catch {
          // skip — placeholder will be shown
        }
      }

      setThumbnails(map);
    }, 300);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [pixiRefs, components]);

  return thumbnails;
}
