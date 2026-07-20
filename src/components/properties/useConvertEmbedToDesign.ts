import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

/**
 * Shared "Convert to design" logic for embed nodes — used by both
 * `EmbedActionBar` (canvas overlay) and `EmbedContentSection` (properties
 * panel). Guards against re-entrant clicks with a ref (state alone lags one
 * render behind), converts via `sceneStore`, and selects the resulting frame.
 */
export function useConvertEmbedToDesign(nodeId: string) {
  const [converting, setConverting] = useState(false);
  const conversionInFlightRef = useRef(false);

  const convertToDesign = useCallback(async () => {
    if (conversionInFlightRef.current) return;
    conversionInFlightRef.current = true;
    setConverting(true);
    try {
      const newFrameId = await useSceneStore.getState().convertEmbedToDesign(nodeId);
      if (newFrameId) {
        useSelectionStore.getState().setSelectedIds([newFrameId]);
      }
    } catch (error) {
      console.error("Failed to convert embed to design:", error);
      toast.error("Couldn't convert this embed to a design — please try again.");
    } finally {
      conversionInFlightRef.current = false;
      setConverting(false);
    }
  }, [nodeId]);

  return { converting, convertToDesign };
}
