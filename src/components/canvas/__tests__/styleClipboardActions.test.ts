import { beforeEach, describe, expect, it } from "vitest";
import { resetStores, seedScene } from "@/test/fixtures";
import { useSceneStore, createSnapshot } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useHistoryStore } from "@/store/historyStore";
import { useStyleClipboardStore } from "@/store/styleClipboardStore";
import { createStyleClipboardActions } from "../styleClipboardActions";

describe("createStyleClipboardActions", () => {
  beforeEach(() => {
    resetStores();
    seedScene();
    useStyleClipboardStore.setState({ copiedStyle: null });
  });

  function makeActions() {
    return createStyleClipboardActions({
      updateNode: useSceneStore.getState().updateNode,
      saveHistory: (snapshot) => useHistoryStore.getState().saveHistory(snapshot),
      startBatch: () => useHistoryStore.getState().startBatch(),
      endBatch: () => useHistoryStore.getState().endBatch(),
    });
  }

  it("copies the selected node's style into the style clipboard", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    const { copyStyleSelection } = makeActions();

    copyStyleSelection();

    const { copiedStyle } = useStyleClipboardStore.getState();
    expect(copiedStyle?.fill).toBe("#ff0000");
    expect(copiedStyle?.strokeWidth).toBe(1);
    expect(copiedStyle?.cornerRadius).toBe(4);
  });

  it("pastes rect -> rect2 transferring fill and cornerRadius, as a single undo step", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    const { copyStyleSelection, pasteStyleSelection } = makeActions();
    copyStyleSelection();

    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);
    const pastBefore = useHistoryStore.getState().past.length;
    pasteStyleSelection();

    const rect2 = useSceneStore.getState().nodesById.rect2;
    expect(rect2.fill).toBe("#ff0000");
    expect((rect2 as { cornerRadius?: number }).cornerRadius).toBe(4);
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });

  it("pastes rect -> text1 transferring only shared style, not cornerRadius", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    const { copyStyleSelection, pasteStyleSelection } = makeActions();
    copyStyleSelection();

    useSelectionStore.setState({ selectedIds: ["text1"] } as never);
    pasteStyleSelection();

    const text1 = useSceneStore.getState().nodesById.text1;
    expect(text1.fill).toBe("#ff0000");
    expect((text1 as { cornerRadius?: number }).cornerRadius).toBeUndefined();
    // original text-only props remain untouched
    expect((text1 as { fontSize?: number }).fontSize).toBe(16);
  });

  it("applies to every node in a multi-selection with a single undo step", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    const { copyStyleSelection, pasteStyleSelection } = makeActions();
    copyStyleSelection();

    useSelectionStore.setState({ selectedIds: ["rect2", "text1"] } as never);
    const pastBefore = useHistoryStore.getState().past.length;
    pasteStyleSelection();

    const state = useSceneStore.getState().nodesById;
    expect(state.rect2.fill).toBe("#ff0000");
    expect(state.text1.fill).toBe("#ff0000");
    expect(useHistoryStore.getState().past.length).toBe(pastBefore + 1);
  });

  it("undo restores pre-paste state in one step", () => {
    useSelectionStore.setState({ selectedIds: ["rect1"] } as never);
    const { copyStyleSelection, pasteStyleSelection } = makeActions();
    copyStyleSelection();

    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);
    pasteStyleSelection();
    expect(useSceneStore.getState().nodesById.rect2.fill).toBe("#ff0000");

    const snapshot = createSnapshot(useSceneStore.getState());
    const prev = useHistoryStore.getState().undo(snapshot);
    expect(prev).not.toBeNull();
    expect(prev?.nodesById.rect2.fill).toBe("#00ff00");
  });

  it("does nothing when the clipboard is empty", () => {
    useSelectionStore.setState({ selectedIds: ["rect2"] } as never);
    const { pasteStyleSelection } = makeActions();
    const pastBefore = useHistoryStore.getState().past.length;

    pasteStyleSelection();

    expect(useHistoryStore.getState().past.length).toBe(pastBefore);
    expect(useSceneStore.getState().nodesById.rect2.fill).toBe("#00ff00");
  });
});
