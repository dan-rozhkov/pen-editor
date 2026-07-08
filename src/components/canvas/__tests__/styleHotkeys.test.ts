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

describe("keyboardCommands — copy/paste properties hotkeys", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 10, height: 10, children: [] } } as never,
      parentById: {},
      childrenById: { F: [] },
      rootIds: ["F"],
    });
    useSelectionStore.setState({ selectedIds: ["F"], enteredContainerId: null } as never);
  });

  it("Cmd+Opt+C triggers copyStyleSelection, not the plain copySelection", () => {
    handler(key("KeyC", { metaKey: true, altKey: true }));
    expect(deps.copyStyleSelection).toHaveBeenCalledTimes(1);
    expect(deps.copySelection).not.toHaveBeenCalled();
  });

  it("Cmd+Opt+V triggers pasteStyleSelection", () => {
    handler(key("KeyV", { metaKey: true, altKey: true }));
    expect(deps.pasteStyleSelection).toHaveBeenCalledTimes(1);
  });

  it("plain Cmd+C still triggers copySelection", () => {
    handler(key("KeyC", { metaKey: true }));
    expect(deps.copySelection).toHaveBeenCalledTimes(1);
    expect(deps.copyStyleSelection).not.toHaveBeenCalled();
  });

  it("blocks Cmd+Opt+V (a mutation) in view mode", () => {
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });
    handler(key("KeyV", { metaKey: true, altKey: true }));
    expect(deps.pasteStyleSelection).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+C triggers copyAsCss, not the plain copySelection", () => {
    handler(key("KeyC", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsCss).toHaveBeenCalledTimes(1);
    expect(deps.copySelection).not.toHaveBeenCalled();
  });

  it("Cmd+Shift+S triggers copyAsSvg", () => {
    handler(key("KeyS", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsSvg).toHaveBeenCalledTimes(1);
  });

  it("copyAsCss is allowed (non-mutating) in view mode", () => {
    useEditorModeStore.setState({ mode: "view", presentFrameIds: [], presentIndex: 0 });
    handler(key("KeyC", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsCss).toHaveBeenCalledTimes(1);
  });
});
