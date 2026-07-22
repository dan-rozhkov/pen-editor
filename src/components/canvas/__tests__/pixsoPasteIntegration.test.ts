import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useClipboardStore } from "@/store/clipboardStore";
import rectHtml from "@/lib/pixsoPaste/__tests__/fixtures/rect.html?raw";
import textHtml from "@/lib/pixsoPaste/__tests__/fixtures/text.html?raw";
import type { RectNode, TextNode } from "@/types/scene";
import { createClipboardActions } from "../clipboardActions";

vi.mock("sonner", () => ({ toast: vi.fn() }));

/**
 * A minimal fake ClipboardEvent: `handlePaste` only reads `target`,
 * `composedPath`, `clipboardData.getData` and `clipboardData.items` — no need
 * for a real browser ClipboardEvent/DataTransfer. Mirrors the h2d paste test's
 * harness exactly.
 */
function fakeClipboardEvent(html: string): ClipboardEvent {
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

describe("handlePaste — Pixso clipboard payload", () => {
  beforeEach(() => {
    resetStores();
    useClipboardStore.setState({ copiedNodes: [], lastCopiedAt: 0 });
  });

  function makeActions() {
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

  it("converts a Pixso rect clipboard payload into a red 200x100 rect node", async () => {
    const { handlePaste } = makeActions();

    await handlePaste(fakeClipboardEvent(rectHtml));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    const node = state.nodesById[state.rootIds[0]] as RectNode;
    expect(node.type).toBe("rect");
    expect(Math.round(node.width)).toBe(200);
    expect(Math.round(node.height)).toBe(100);
    expect(node.fill).toBe("#ff0000");
  });

  it("converts a Pixso text clipboard payload into a text node with the characters", async () => {
    const { handlePaste } = makeActions();

    await handlePaste(fakeClipboardEvent(textHtml));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    const node = state.nodesById[state.rootIds[0]] as TextNode;
    expect(node.type).toBe("text");
    expect(node.text.startsWith("Карточка товара")).toBe(true);
  });
});
