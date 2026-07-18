import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDrawModeStore } from "@/store/drawModeStore";
import { useCommentsStore } from "@/store/commentsStore";

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

describe("keyboardCommands — comment mode (C / Shift+C)", () => {
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    handler = createKeyDownHandler(makeDeps());
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({ nodesById: {}, parentById: {}, childrenById: {}, rootIds: [] } as never);
    useSelectionStore.setState({ selectedIds: [], enteredContainerId: null } as never);
    useDrawModeStore.setState({ activeTool: null });
    useCommentsStore.setState({ threads: [], draftAnchor: null, pinsHidden: false });
  });

  it("plain C enters comment mode", () => {
    handler(key("KeyC"));
    expect(useDrawModeStore.getState().activeTool).toBe("comment");
  });

  it("plain C again toggles comment mode back off", () => {
    handler(key("KeyC"));
    handler(key("KeyC"));
    expect(useDrawModeStore.getState().activeTool).toBeNull();
  });

  it("Shift+C toggles pin visibility without changing the tool", () => {
    handler(key("KeyC", { shiftKey: true }));
    expect(useCommentsStore.getState().pinsHidden).toBe(true);
    expect(useDrawModeStore.getState().activeTool).toBeNull();

    handler(key("KeyC", { shiftKey: true }));
    expect(useCommentsStore.getState().pinsHidden).toBe(false);
  });

  it("Cmd+Shift+C stays Copy-as-CSS (not the comment toggle)", () => {
    const deps = makeDeps();
    const h = createKeyDownHandler(deps);
    h(key("KeyC", { metaKey: true, shiftKey: true }));
    expect(deps.copyAsCss).toHaveBeenCalled();
    expect(useCommentsStore.getState().pinsHidden).toBe(false);
  });

  it("Esc while in comment mode routes to cancelDrawing (which exits the tool + drops the draft)", () => {
    const deps = makeDeps();
    const h = createKeyDownHandler(deps);
    useDrawModeStore.setState({ activeTool: "comment" });
    h(key("Escape"));
    expect(deps.cancelDrawing).toHaveBeenCalled();
  });

  it("plain N toggles the connector tool (moved off C by cmt-01)", () => {
    const deps = makeDeps();
    const h = createKeyDownHandler(deps);
    h(key("KeyN"));
    // The tool-letter dispatch goes straight to the store (not the injected
    // `toggleTool` dep) — see keyboardCommands.tools.test.ts.
    expect(useDrawModeStore.getState().activeTool).toBe("connector");
  });
});
