import { useEffect, useState } from "react";
import { useCanvasRefStore } from "@/store/canvasRefStore";
import { findPixiChild } from "@/utils/pixiUtils";
import type { FlatFrameNode } from "@/types/scene";

const EMPTY_THUMBNAILS: Map<string, string> = new Map();

/**
 * Generic Pixi-extract thumbnail generator for any list of nodes with an
 * `id` that resolves to a Pixi container in the scene (frames, in practice).
 * Shared by ComponentsPanel (reusable components) and SlidesPanel (top-level
 * frames) — same "extract.base64 after a settle delay" mechanism.
 */
export function useNodeThumbnails(nodes: { id: string }[]) {
  const pixiRefs = useCanvasRefStore((s) => s.pixiRefs);
  const [thumbnails, setThumbnails] = useState<Map<string, string> | null>(null);

  useEffect(() => {
    if (!pixiRefs || nodes.length === 0) return;

    const timeout = setTimeout(async () => {
      const { app, sceneRoot } = pixiRefs;
      const map = new Map<string, string>();

      for (const node of nodes) {
        const container = findPixiChild(sceneRoot, node.id);
        if (!container) continue;
        try {
          const raw = await app.renderer.extract.base64(container);
          // raw may or may not include the data URI prefix
          const dataUrl = raw.startsWith("data:")
            ? raw
            : `data:image/png;base64,${raw}`;
          map.set(node.id, dataUrl);
        } catch {
          // skip — placeholder will be shown
        }
      }

      setThumbnails(map);
    }, 300);

    return () => clearTimeout(timeout);
  }, [pixiRefs, nodes]);

  // Derived: with no canvas refs or no nodes there are no thumbnails;
  // otherwise keep showing the last generated map until the next one is ready
  // (same behavior as before, without setState inside the effect body).
  if (!pixiRefs || nodes.length === 0) return EMPTY_THUMBNAILS;
  return thumbnails ?? EMPTY_THUMBNAILS;
}

export function useComponentThumbnails(components: FlatFrameNode[]) {
  return useNodeThumbnails(components);
}
