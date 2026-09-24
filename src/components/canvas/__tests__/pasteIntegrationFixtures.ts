import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useClipboardStore } from "@/store/clipboardStore";
import { createClipboardActions } from "../clipboardActions";

// Shared harness for h2dPasteIntegration.test.ts and pixsoPasteIntegration.test.ts
// — both drive the real `handlePaste` against a fake ClipboardEvent and the
// real Zustand stores.

/**
 * A minimal fake ClipboardEvent: `handlePaste` only reads `target`,
 * `composedPath`, `clipboardData.getData`, `clipboardData.items` and calls
 * `preventDefault` — no need for a real browser ClipboardEvent/DataTransfer.
 */
export function fakeClipboardEvent(html: string): ClipboardEvent {
  return {
    target: null,
    composedPath: () => [],
    preventDefault: () => {},
    clipboardData: {
      getData: (type: string) => (type === "text/html" ? html : ""),
      items: [] as unknown as DataTransferItemList,
    },
  } as unknown as ClipboardEvent;
}

export function makePasteActions() {
  return createClipboardActions({
    dimensions: { width: 1200, height: 800 },
    addNode: useSceneStore.getState().addNode,
    addChildToFrame: useSceneStore.getState().addChildToFrame,
    deleteNode: useSceneStore.getState().deleteNode,
    saveHistory: (snapshot) => useHistoryStore.getState().saveHistory(snapshot),
    startBatch: () => useHistoryStore.getState().startBatch(),
    endBatch: () => useHistoryStore.getState().endBatch(),
    clearSelection: () => useSelectionStore.getState().clearSelection(),
    copyNodes: (nodes) => useClipboardStore.getState().copyNodes(nodes),
  });
}
