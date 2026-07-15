import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";

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

function key(code: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { code, key: code, bubbles: true, cancelable: true, ...opts });
}

describe("keyboardCommands — view mode gating", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 10, height: 10, children: [] } } as never,
      parentById: {},
      childrenById: { F: [] },
      rootIds: ["F"],
    });
    useSelectionStore.setState({ selectedIds: ["F"], enteredContainerId: null } as never);
  });

  it("does not delete on Delete/Backspace in view mode", () => {
    handler(key("Delete"));
    handler(key("Backspace"));
    expect(deps.deleteNode).not.toHaveBeenCalled();
  });

  it("does not nudge with arrow keys in view mode", () => {
    handler(key("ArrowLeft"));
    handler(key("ArrowRight"));
    expect(deps.moveNode).not.toHaveBeenCalled();
    expect(deps.updateNode).not.toHaveBeenCalled();
  });

  it("does not group or cut in view mode", () => {
    handler(key("KeyG", { metaKey: true }));
    handler(key("KeyX", { metaKey: true }));
    expect(deps.groupNodes).not.toHaveBeenCalled();
    expect(deps.cutSelection).not.toHaveBeenCalled();
  });

  it("still allows copy and fit-to-content in view mode", () => {
    handler(key("KeyC", { metaKey: true }));
    handler(key("Digit0", { metaKey: true }));
    expect(deps.copySelection).toHaveBeenCalledTimes(1);
    expect(deps.fitToContent).toHaveBeenCalledTimes(1);
  });

  it("Escape exits view mode", () => {
    handler(key("Escape"));
    expect(useEditorModeStore.getState().mode).toBe("edit");
  });

  it("in edit mode, Delete still deletes (gating only applies to view/present)", () => {
    useEditorModeStore.setState({ mode: "edit" });
    handler(key("Delete"));
    expect(deps.deleteNode).toHaveBeenCalledWith("F");
  });

  it("Cmd+Z (undo) does not trigger deps.undo in view mode", () => {
    handler(key("KeyZ", { metaKey: true }));
    expect(deps.undo).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+Z (redo) does not trigger deps.redo in view mode", () => {
    handler(key("KeyZ", { metaKey: true, shiftKey: true }));
    expect(deps.redo).not.toHaveBeenCalled();
  });
});
