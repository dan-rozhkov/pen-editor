import { useEffect, useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { findPixiChild } from "@/utils/pixiUtils";
import type { FlatFrameNode } from "@/types/scene";

const EMPTY_THUMBNAILS: Map<string, string> = new Map();

export function useComponentThumbnails(components: FlatFrameNode[]) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const [thumbnails, setThumbnails] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    if (!pixiRefs || components.length === 0) return;

    const timeout = setTimeout(async () => {
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

    return () => clearTimeout(timeout);
  }, [pixiRefs, components]);

  // Derived: with no canvas refs or no components there are no thumbnails;
  // otherwise keep showing the last generated map until the next one is ready
  // (same behavior as before, without setState inside the effect body).
  if (!pixiRefs || components.length === 0) return EMPTY_THUMBNAILS;
  return thumbnails ?? EMPTY_THUMBNAILS;
}
