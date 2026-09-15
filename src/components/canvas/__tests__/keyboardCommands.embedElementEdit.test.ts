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
 * Round-2 code-review finding: Escape while a single-element inline text
 * edit is in flight (`EmbedLayer.tsx`'s dblclick-to-edit) must cancel the
 * EDIT and leave the picker's element `selection` untouched — not fall
 * through to `exitContainer()`, which sees that `selection` as leftover
 * state and clears it (dropping the highlight, bouncing the properties
 * panel back to the embed) as an unrelated side effect.
 *
 * Mirrors `keyboardCommands.embedElementSortable.test.ts`'s coverage for the
 * analogous `cancelElementDrag` callback exactly — same store-registered-
 * callback contract, same reason a capture-phase listener on the edited
 * element itself can't win this race (see `cancelElementEdit`'s doc comment
 * in `embedPickerStore.ts`).
 */
describe("keyboardCommands — Escape during an embed element inline text edit", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useEmbedPickerStore.getState().reset();
  });

  it("cancels the edit via the registered callback and leaves the element selection intact", () => {
    const cancel = vi.fn();
    useEmbedPickerStore.getState().startPicking("e1");
    useEmbedPickerStore.getState().selectElement(
      {
        embedId: "e1",
        path: "div:nth-of-type(1)",
        tagName: "div",
        classes: [],
        textPreview: "hi",
        outerHtml: "<div>hi</div>",
      },
      "<div>hi</div>",
    );
    useEmbedPickerStore.getState().setCancelElementEdit(cancel);

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(cancel).toHaveBeenCalledTimes(1);
    // The whole point: exitContainer()'s own "clear a picked element" step
    // never ran, because this returned before reaching it.
    expect(useEmbedPickerStore.getState().selection?.embedId).toBe("e1");
    expect(deps.clearSelection).not.toHaveBeenCalled();
  });

  it("takes priority over cancelElementDrag when (hypothetically) both were registered", () => {
    // Not a reachable real state — drag and edit are mutually exclusive —
    // but pins the intended precedence order in the handler itself rather
    // than leaving it as an accident of code order.
    const cancelEdit = vi.fn();
    const cancelDrag = vi.fn();
    useEmbedPickerStore.getState().setCancelElementDrag(cancelDrag);
    useEmbedPickerStore.getState().setCancelElementEdit(cancelEdit);

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(cancelDrag).toHaveBeenCalledTimes(1);
    expect(cancelEdit).not.toHaveBeenCalled();
  });

  it("falls through to the ordinary Escape chain when no edit is in flight", () => {
    useEmbedPickerStore.getState().startPicking("e1");

    handler(new KeyboardEvent("keydown", { code: "Escape", key: "Escape" }));

    expect(useEmbedPickerStore.getState().pickingEmbedId).toBe("e1");
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });
});
