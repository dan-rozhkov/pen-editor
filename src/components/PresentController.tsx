import { useEffect } from "react";
import { useEditorModeStore, presentFitNode } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useViewportStore } from "@/store/viewportStore";

/** Fits the current present-mode frame to the window and refits on resize. */
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
        .fitToContent(target, window.innerWidth, window.innerHeight);
    };

    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [mode, frameId]);

  return null;
}
