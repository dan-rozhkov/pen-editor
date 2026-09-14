import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useEmbedPickerStore } from "@/store/embedPickerStore";

function makeDeps(): KeyDownHandlerDeps {
  return {
    dimensions: { width: 800, height: 600 },
    setIsSpacePressed: vi.fn(),
    setIsPanning: vi.fn(),
    deleteNode: vi.fn(),
    updateNode: vi.fn(),
    moveNode: vi.fn(),
    groupNodes: vi.fn(() => null),
    ungroupNodes: vi.fn(() => []),
    wrapInAutoLayoutFrame: vi.fn(() => null),
    booleanOperation: vi.fn(() => null),
    restoreSnapshot: vi.fn(),
    saveHistory: vi.fn(),
    startBatch: vi.fn(),
    endBatch: vi.fn(),
    undo: vi.fn(() => null),
    redo: vi.fn(() => null),
    fitToContent: vi.fn(),
    toggleTool: vi.fn(),
    cancelDrawing: vi.fn(),
    clearSelection: vi.fn(),
    copySelection: vi.fn(),
    cutSelection: vi.fn(),
    copyStyleSelection: vi.fn(),
    pasteStyleSelection: vi.fn(),
    copyAsCss: vi.fn(),
    copyAsSvg: vi.fn(),
  };
}

/**
 * Escape has to mean "cancel the element drag" while one is in flight inside
 * an embed, and "leave the picker" otherwise — the same two-step contract a
 * native-node drag gets via `useDragStore.cancelDrag`.
 *
 * This lives at the keyboardCommands level on purpose: the drag gesture used
 * to try to win this race from its own capture-phase `keydown` listener on
 * `window`, which cannot work — capture listeners on the SAME target fire in
 * registration order, and this global handler is registered at app mount,
 * before picking ever starts. The contract is therefore a callback this
 * handler looks up, not event ordering.
 */
describe("keyboardCommands — Escape during an embed element drag", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useEmbedPickerStore.getState().reset();
  });

  it("cancels the drag and leaves the picker running", () => {
    const cancel = vi.fn();
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().setCancelElementDrag(cancel);

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("exits the picker when no drag is in flight", () => {
    useEmbedPickerStore.getState().startPicking("e1");

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBeNull();
  });
});
