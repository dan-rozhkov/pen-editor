import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyDownHandler, type KeyDownHandlerDeps } from "../keyboardCommands";
import { useEditorModeStore } from "@/store/editorModeStore";
import { useSceneStore } from "@/store/sceneStore";
import { useSelectionStore } from "@/store/selectionStore";
import { useDevModeStore } from "@/store/devModeStore";
import { useMeasurementsStore } from "@/store/measurementsStore";

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

describe("keyboardCommands — dev mode gating", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    // Dev mode is orthogonal to editorModeStore — `mode` stays "edit".
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
    useSceneStore.setState({
      nodesById: { F: { id: "F", type: "frame", x: 0, y: 0, width: 10, height: 10, children: [] } } as never,
      parentById: {},
      childrenById: { F: [] },
      rootIds: ["F"],
    });
    useSelectionStore.setState({ selectedIds: ["F"], enteredContainerId: null } as never);
    useDevModeStore.getState().setActive(true);
  });

  afterEach(() => {
    useDevModeStore.getState().setActive(false);
  });

  it("does not delete on Delete/Backspace in dev mode", () => {
    handler(key("Delete"));
    handler(key("Backspace"));
    expect(deps.deleteNode).not.toHaveBeenCalled();
  });

  it("does not nudge with arrow keys in dev mode", () => {
    handler(key("ArrowLeft"));
    handler(key("ArrowRight"));
    expect(deps.moveNode).not.toHaveBeenCalled();
    expect(deps.updateNode).not.toHaveBeenCalled();
  });

  it("does not activate a draw tool via a plain tool key in dev mode", () => {
    handler(key("KeyR"));
    expect(deps.toggleTool).not.toHaveBeenCalled();
  });

  it("does not group or cut in dev mode", () => {
    handler(key("KeyG", { metaKey: true }));
    handler(key("KeyX", { metaKey: true }));
    expect(deps.groupNodes).not.toHaveBeenCalled();
    expect(deps.cutSelection).not.toHaveBeenCalled();
  });

  it("still allows copy and fit-to-content in dev mode", () => {
    handler(key("KeyC", { metaKey: true }));
    handler(key("Digit0", { metaKey: true }));
    expect(deps.copySelection).toHaveBeenCalledTimes(1);
    expect(deps.fitToContent).toHaveBeenCalledTimes(1);
  });

  it("still allows undo (Cmd+Z) and redo (Cmd+Shift+Z) in dev mode", () => {
    handler(key("KeyZ", { metaKey: true }));
    expect(deps.undo).toHaveBeenCalledTimes(1);

    handler(key("KeyZ", { metaKey: true, shiftKey: true }));
    expect(deps.redo).toHaveBeenCalledTimes(1);
  });

  it("Shift+D toggles dev mode off", () => {
    expect(useDevModeStore.getState().active).toBe(true);
    handler(key("KeyD", { shiftKey: true }));
    expect(useDevModeStore.getState().active).toBe(false);
  });

  it("Shift+D toggles dev mode back on from normal edit mode", () => {
    useDevModeStore.getState().setActive(false);
    handler(key("KeyD", { shiftKey: true }));
    expect(useDevModeStore.getState().active).toBe(true);
  });

  it("Shift+D while typing in an input does nothing", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    try {
      const event = new KeyboardEvent("keydown", {
        code: "KeyD",
        key: "D",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "target", { value: input });
      handler(event);
      expect(useDevModeStore.getState().active).toBe(true);
    } finally {
      document.body.removeChild(input);
    }
  });

  it("Escape in dev mode clears selection instead of a no-op exitToEdit", () => {
    handler(key("Escape"));
    expect(deps.clearSelection).toHaveBeenCalledTimes(1);
  });

  it("Escape in dev mode also clears any stale selected measurement", () => {
    useMeasurementsStore.setState({ selectedMeasurementId: "m1" });
    handler(key("Escape"));
    expect(useMeasurementsStore.getState().selectedMeasurementId).toBeNull();
  });

  it("in normal edit mode (dev mode off), Delete still deletes", () => {
    useDevModeStore.getState().setActive(false);
    handler(key("Delete"));
    expect(deps.deleteNode).toHaveBeenCalledWith("F");
  });
});
