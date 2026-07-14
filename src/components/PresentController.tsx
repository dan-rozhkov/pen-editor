import { useEffect } from "react";
import { useEditorModeStore, presentFitNode } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";

/**
 * Fits the current present-mode frame to the window (fit-to-width, not
 * fit-to-content — a slide should fill the screen edge to edge horizontally,
 * with a tall slide scrolling from the top) and refits on resize/slide
 * change (which also resets any vertical scroll, since fitToWidth always
 * recomputes y from scratch).
 *
 * Slide isolation (hiding every other top-level container while presenting)
 * is NOT handled here. It is fully owned by the declarative resync path:
 * syncNodeTree's `applyTextEditingVisibility` derives the present-mode hide
 * set from `useEditorModeStore` + `rootIds` on every resync (respecting each
 * node's own `visible`/`enabled` flags), and pixiSync subscribes to
 * `useEditorModeStore` so mode/presentIndex changes trigger that resync
 * directly. An imperative effect here would race that subscriber on
 * exit — React effect cleanups run after the store subscriber that fires
 * synchronously on `set()` — and would have to force every root back to
 * `visible = true`, clobbering nodes the user explicitly hid via the Layers
 * panel. See src/pixi/__tests__/presentIsolation.test.ts for isolation
 * coverage (enter/next/prev/exit, including a hidden root node).
 */
export function PresentController() {
  const mode = useEditorModeStore((s) => s.mode);
  const frameId = useEditorModeStore((s) => s.presentFrameIds[s.presentIndex]);

  useEffect(() => {
    if (mode !== "present") return;

    const fit = () => {
      const nodes = useSceneStore.getState().getNodes();
      const target = presentFitNode(nodes, frameId);
      if (target.length === 0) return;
      useViewportStore
        .getState()
        .fitToWidth(target, window.innerWidth, window.innerHeight);
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mode, frameId]);

  return null;
}
