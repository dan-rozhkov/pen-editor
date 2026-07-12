import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetStores } from "@/test/fixtures";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useClipboardStore } from "@/store/clipboardStore";
import { H2D_FIXTURE_HTML } from "@/lib/h2dPaste/__tests__/h2dFixtureHtml";
import type { FrameNode, SceneNode } from "@/types/scene";
import { generateId } from "@/types/scene";
import { createClipboardActions } from "../clipboardActions";

vi.mock("sonner", () => ({ toast: vi.fn() }));

/**
 * A minimal fake ClipboardEvent: `handlePaste` only reads `target`,
 * `composedPath`, `clipboardData.getData`, `clipboardData.items` and calls
 * `preventDefault` — no need for a real browser ClipboardEvent/DataTransfer.
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

/** h2d markers present (so `isH2dClipboardHtml` matches) but the base64 payload is garbage. */
const CORRUPT_H2D_HTML = '<span data-h2d="<!--(figh2d)not-valid-base64!!!(/figh2d)-->"></span>';

describe("handlePaste — h2d clipboard payload", () => {
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

  it("converts an h2d clipboard payload into scene nodes and selects them", async () => {
    const { handlePaste } = makeActions();

    await handlePaste(fakeClipboardEvent(H2D_FIXTURE_HTML));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    const root = state.nodesById[state.rootIds[0]] as FrameNode;
    expect(root.name).toBe("Capture test page");
    expect(state.childrenById[root.id]?.length ?? 0).toBeGreaterThan(0);

    const selected = useSelectionStore.getState().selectedIds;
    expect(selected).toEqual([root.id]);
  });

  it("converts capture.js HTML with entity-escaped markers", async () => {
    const { handlePaste } = makeActions();
    const escapedHtml = H2D_FIXTURE_HTML
      .replaceAll("<!--", "&lt;!--")
      .replaceAll("-->", "--&gt;");

    await handlePaste(fakeClipboardEvent(escapedHtml));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    expect(state.nodesById[state.rootIds[0]]?.name).toBe("Capture test page");
  });

  it("pastes the same h2d payload twice as two disjoint root frames", async () => {
    const { handlePaste } = makeActions();

    await handlePaste(fakeClipboardEvent(H2D_FIXTURE_HTML));
    await handlePaste(fakeClipboardEvent(H2D_FIXTURE_HTML));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(2);
    expect(state.rootIds[0]).not.toBe(state.rootIds[1]);
    const [firstRoot, secondRoot] = state.rootIds.map((id) => state.nodesById[id] as FrameNode);
    expect(firstRoot.name).toBe("Capture test page");
    expect(secondRoot.name).toBe("Capture test page");
    // Every id in each root's subtree is distinct across the two pastes.
    const idsOf = (id: string, out: Set<string> = new Set()): Set<string> => {
      out.add(id);
      for (const childId of state.childrenById[id] ?? []) idsOf(childId, out);
      return out;
    };
    const firstIds = idsOf(firstRoot.id);
    const secondIds = idsOf(secondRoot.id);
    for (const id of firstIds) expect(secondIds.has(id)).toBe(false);
  });

  it("falls through to the internal clipboard fallback when the h2d payload is corrupt", async () => {
    const { handlePaste } = makeActions();

    // Seed an internal-clipboard node so the fallback branch has something to paste.
    const fallbackNode: SceneNode = {
      id: generateId(),
      type: "frame",
      name: "Fallback rect",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      children: [],
    };
    // Outside the internal-clipboard "prefer" window so the corrupt-h2d branch
    // is attempted first, but still present for the final fallback branch.
    useClipboardStore.setState({ copiedNodes: [fallbackNode], lastCopiedAt: 0 });

    await handlePaste(fakeClipboardEvent(CORRUPT_H2D_HTML));

    const state = useSceneStore.getState();
    expect(state.rootIds).toHaveLength(1);
    const pasted = state.nodesById[state.rootIds[0]] as FrameNode;
    expect(pasted.name).toBe("Fallback rect");
    expect(pasted.id).not.toBe(fallbackNode.id); // pasteInternalNodes clones with a new id
  });
});
