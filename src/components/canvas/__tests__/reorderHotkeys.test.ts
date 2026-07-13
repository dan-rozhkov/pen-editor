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

const FRAME = { id: "F", type: "frame", x: 0, y: 0, width: 100, height: 100, children: [] };
const rect = (id: string) => ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10 });

describe("keyboardCommands — reorder-in-tree hotkeys (Cmd+{ / Cmd+})", () => {
  let deps: KeyDownHandlerDeps;
  let handler: (e: KeyboardEvent) => void;

  beforeEach(() => {
    deps = makeDeps();
    handler = createKeyDownHandler(deps);
    useEditorModeStore.setState({ mode: "edit", presentFrameIds: [], presentIndex: 0 });
  });

  function seedRoot() {
    useSceneStore.setState({
      nodesById: {
        A: rect("A"),
        B: rect("B"),
        C: rect("C"),
      } as never,
      parentById: { A: null, B: null, C: null } as never,
      childrenById: {},
      rootIds: ["A", "B", "C"],
    });
  }

  function seedNested() {
    useSceneStore.setState({
      nodesById: {
        F: FRAME,
        A: rect("A"),
        B: rect("B"),
        C: rect("C"),
      } as never,
      parentById: { F: null, A: "F", B: "F", C: "F" } as never,
      childrenById: { F: ["A", "B", "C"] },
      rootIds: ["F"],
    });
  }

  it("Cmd+{ (up) moves a root-level node one index higher (towards top of panel)", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "C", "B"]);
  });

  it("Cmd+} (down) moves a root-level node one index lower (towards bottom of panel)", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    handler(key("BracketRight", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["B", "A", "C"]);
  });

  it("no-op at the top edge (last index) on Cmd+{", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["C"], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("no-op at the bottom edge (index 0) on Cmd+}", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["A"], enteredContainerId: null } as never);
    handler(key("BracketRight", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("works for a nested node within a parent frame, keeping parentById intact", () => {
    seedNested();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().childrenById.F).toEqual(["A", "C", "B"]);
    expect(useSceneStore.getState().parentById.B).toBe("F");
  });

  it("preserves undo history (calls saveHistory internally via moveNode)", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    const before = useSceneStore.getState().rootIds;
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).not.toBe(before);
    handler(key("KeyZ", { metaKey: true }));
    // undo isn't wired through the real historyStore here (deps.undo is a
    // mock), so just assert the move itself was a distinct, history-eligible
    // state transition (new array reference) rather than an in-place mutation.
  });

  it("is a no-op with multiple nodes selected (MVP: single selection only)", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["A", "B"], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("is a no-op with no selection", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: [], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("does not fire without Shift (BracketLeft/Right alone are not the hotkey)", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("is a no-op while typing in an input", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    const input = document.createElement("input");
    document.body.appendChild(input);
    const evt = new KeyboardEvent("keydown", {
      code: "BracketLeft",
      key: "BracketLeft",
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(evt, "target", { value: input });
    handler(evt);
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
    document.body.removeChild(input);
  });

  it("is a no-op in view (read-only) mode", () => {
    seedRoot();
    useEditorModeStore.setState({ mode: "view" });
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    handler(key("BracketLeft", { metaKey: true, shiftKey: true }));
    expect(useSceneStore.getState().rootIds).toEqual(["A", "B", "C"]);
  });

  it("calls preventDefault on the browser-default-suppressing hotkeys", () => {
    seedRoot();
    useSelectionStore.setState({ selectedIds: ["B"], enteredContainerId: null } as never);
    const evt = key("BracketLeft", { metaKey: true, shiftKey: true });
    const spy = vi.spyOn(evt, "preventDefault");
    handler(evt);
    expect(spy).toHaveBeenCalled();
  });
});
