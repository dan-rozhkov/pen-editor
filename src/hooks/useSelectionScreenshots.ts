import { useEffect, useState } from "react";
import { useSelectionStore } from "@/store/selectionStore";
import { useSceneStore } from "@/store/sceneStore";
import { useChatStore } from "@/store/chatStore";
import { modelSupportsVision } from "@/lib/chatModels";
import { captureNodeScreenshot } from "@/lib/captureNodeScreenshot";

export interface SelectionScreenshot {
  nodeId: string;
  name: string;
  dataUrl: string;
}

// Selection changes rapidly during marquee drag; wait for it to settle before
// paying for a render extraction.
const CAPTURE_DEBOUNCE_MS = 200;

/**
 * Screenshots of the currently selected canvas nodes, kept in sync with the
 * selection. Used to show selected elements as image previews above the chat
 * input and to attach them as visual context to the outgoing message.
 *
 * Returns an empty list when the model can't read images, nothing is selected,
 * or the PixiJS renderer isn't available (e.g. in unit tests).
 */
export function useSelectionScreenshots(): SelectionScreenshot[] {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const model = useChatStore((s) => s.model);
  const supportsVision = modelSupportsVision(model);
  const [screenshots, setScreenshots] = useState<SelectionScreenshot[]>([]);

  // Re-run only when the *set* of selected ids changes, not on every store
  // write (selectionStore replaces the array on unrelated edits too).
  const selectionKey = selectedIds.join(",");

  useEffect(() => {
    if (!supportsVision || selectedIds.length === 0) {
      setScreenshots([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const { nodesById } = useSceneStore.getState();
      const captured = await Promise.all(
        selectedIds.map(async (id) => {
          const node = nodesById[id];
          if (!node) return null;
          const dataUrl = await captureNodeScreenshot(id);
          if (!dataUrl) return null;
          return { nodeId: id, name: node.name ?? id, dataUrl };
        }),
      );
      if (cancelled) return;
      setScreenshots(
        captured.filter((s): s is SelectionScreenshot => s !== null),
      );
    }, CAPTURE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // selectionKey stands in for selectedIds; ids are read fresh inside.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, supportsVision]);

  return screenshots;
}
